import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients, type K8sClients } from "../../../lib/client.js";
import { formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";

export const K8sCostSchema = z.object({
  action: z.enum([
    "namespace_usage",
    "overprovisioned",
    "underprovisioned",
    "idle_resources",
    "recommendations",
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  threshold: z.number().optional(),
  context: z.string().optional(),
});

type K8sCostParams = z.infer<typeof K8sCostSchema>;

interface PodMetricsItem {
  metadata: { name: string; namespace: string };
  containers: Array<{
    name: string;
    usage: { cpu: string; memory: string };
  }>;
}

interface MetricsList<T> {
  items: T[];
}

export function parseCpuValue(cpu: string): number {
  if (cpu.endsWith("n")) {
    return parseInt(cpu, 10) / 1_000_000;
  }
  if (cpu.endsWith("m")) {
    return parseInt(cpu, 10);
  }
  return parseFloat(cpu) * 1000;
}

export function parseMemoryValue(mem: string): number {
  const units: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
  };

  for (const [suffix, multiplier] of Object.entries(units)) {
    if (mem.endsWith(suffix)) {
      return parseFloat(mem.slice(0, -suffix.length)) * multiplier;
    }
  }
  return parseFloat(mem);
}

function formatCpu(milliCpu: number): string {
  return `${Math.round(milliCpu)}m`;
}

function formatMemory(bytes: number): string {
  const mi = 1024 ** 2;
  const gi = 1024 ** 3;
  if (bytes >= gi) return `${(bytes / gi).toFixed(1)}Gi`;
  return `${Math.round(bytes / mi)}Mi`;
}

interface WorkloadUsage {
  name: string;
  namespace: string;
  kind: string;
  cpuRequest: number;
  cpuLimit: number;
  cpuActual: number;
  memRequest: number;
  memLimit: number;
  memActual: number;
}

async function fetchPodMetricsMap(
  clients: K8sClients,
  namespace?: string,
  allNamespaces?: boolean
): Promise<Map<string, { cpu: number; mem: number }>> {
  const metricsMap = new Map<string, { cpu: number; mem: number }>();

  try {
    let items: PodMetricsItem[];
    if (allNamespaces || !namespace) {
      const response = await clients.customObjectsApi.listClusterCustomObject(
        "metrics.k8s.io", "v1beta1", "pods"
      );
      items = ((response.body as MetricsList<PodMetricsItem>).items) || [];
    } else {
      const response = await clients.customObjectsApi.listNamespacedCustomObject(
        "metrics.k8s.io", "v1beta1", namespace, "pods"
      );
      items = ((response.body as MetricsList<PodMetricsItem>).items) || [];
    }

    for (const pod of items) {
      let cpu = 0;
      let mem = 0;
      for (const container of pod.containers || []) {
        cpu += parseCpuValue(container.usage.cpu);
        mem += parseMemoryValue(container.usage.memory);
      }
      const key = `${pod.metadata.namespace}/${pod.metadata.name}`;
      metricsMap.set(key, { cpu, mem });
    }
  } catch {
    // Metrics server not available - return empty map
  }

  return metricsMap;
}

function collectPodResources(pod: k8s.V1Pod): { cpuReq: number; cpuLim: number; memReq: number; memLim: number } {
  let cpuReq = 0, cpuLim = 0, memReq = 0, memLim = 0;
  const containers = pod.spec?.containers || [];
  for (const c of containers) {
    const requests = c.resources?.requests || {};
    const limits = c.resources?.limits || {};
    if (requests.cpu) cpuReq += parseCpuValue(requests.cpu as string);
    if (limits.cpu) cpuLim += parseCpuValue(limits.cpu as string);
    if (requests.memory) memReq += parseMemoryValue(requests.memory as string);
    if (limits.memory) memLim += parseMemoryValue(limits.memory as string);
  }
  return { cpuReq, cpuLim, memReq, memLim };
}

async function getWorkloadUsages(
  clients: K8sClients,
  namespace: string,
  allNamespaces: boolean
): Promise<WorkloadUsage[]> {
  const metricsMap = await fetchPodMetricsMap(clients, namespace, allNamespaces);

  const deployments = allNamespaces
    ? (await clients.appsApi.listDeploymentForAllNamespaces()).body.items
    : (await clients.appsApi.listNamespacedDeployment(namespace)).body.items;

  const statefulsets = allNamespaces
    ? (await clients.appsApi.listStatefulSetForAllNamespaces()).body.items
    : (await clients.appsApi.listNamespacedStatefulSet(namespace)).body.items;

  const allPods = allNamespaces
    ? (await clients.coreApi.listPodForAllNamespaces()).body.items
    : (await clients.coreApi.listNamespacedPod(namespace)).body.items;

  const usages: WorkloadUsage[] = [];

  for (const dep of deployments) {
    const depName = dep.metadata?.name || "unknown";
    const depNs = dep.metadata?.namespace || "default";
    const selector = dep.spec?.selector?.matchLabels || {};
    const pods = allPods.filter((p) => {
      if (p.metadata?.namespace !== depNs) return false;
      const labels = p.metadata?.labels || {};
      return Object.entries(selector).every(([k, v]) => labels[k] === v);
    });

    let cpuReq = 0, cpuLim = 0, cpuActual = 0, memReq = 0, memLim = 0, memActual = 0;
    for (const pod of pods) {
      const res = collectPodResources(pod);
      cpuReq += res.cpuReq;
      cpuLim += res.cpuLim;
      memReq += res.memReq;
      memLim += res.memLim;
      const key = `${pod.metadata?.namespace}/${pod.metadata?.name}`;
      const metrics = metricsMap.get(key);
      if (metrics) {
        cpuActual += metrics.cpu;
        memActual += metrics.mem;
      }
    }

    usages.push({
      name: depName, namespace: depNs, kind: "Deployment",
      cpuRequest: cpuReq, cpuLimit: cpuLim, cpuActual,
      memRequest: memReq, memLimit: memLim, memActual,
    });
  }

  for (const ss of statefulsets) {
    const ssName = ss.metadata?.name || "unknown";
    const ssNs = ss.metadata?.namespace || "default";
    const selector = ss.spec?.selector?.matchLabels || {};
    const pods = allPods.filter((p) => {
      if (p.metadata?.namespace !== ssNs) return false;
      const labels = p.metadata?.labels || {};
      return Object.entries(selector).every(([k, v]) => labels[k] === v);
    });

    let cpuReq = 0, cpuLim = 0, cpuActual = 0, memReq = 0, memLim = 0, memActual = 0;
    for (const pod of pods) {
      const res = collectPodResources(pod);
      cpuReq += res.cpuReq;
      cpuLim += res.cpuLim;
      memReq += res.memReq;
      memLim += res.memLim;
      const key = `${pod.metadata?.namespace}/${pod.metadata?.name}`;
      const metrics = metricsMap.get(key);
      if (metrics) {
        cpuActual += metrics.cpu;
        memActual += metrics.mem;
      }
    }

    usages.push({
      name: ssName, namespace: ssNs, kind: "StatefulSet",
      cpuRequest: cpuReq, cpuLimit: cpuLim, cpuActual,
      memRequest: memReq, memLimit: memLim, memActual,
    });
  }

  return usages;
}

function formatNamespaceUsage(usages: WorkloadUsage[]): string {
  if (usages.length === 0) {
    return "No workloads found.";
  }

  const headers = ["WORKLOAD", "CPU-REQ", "CPU-LIM", "CPU-ACTUAL", "EFFICIENCY", "MEM-REQ", "MEM-ACTUAL"];
  const rows = usages.map((u) => {
    const workload = `${u.kind}/${u.name}`;
    const eff = u.cpuRequest > 0 ? `${((u.cpuActual / u.cpuRequest) * 100).toFixed(1)}%` : "—";
    return [
      workload,
      formatCpu(u.cpuRequest),
      formatCpu(u.cpuLimit),
      formatCpu(u.cpuActual),
      eff,
      formatMemory(u.memRequest),
      formatMemory(u.memActual),
    ];
  });

  const totalCpuReq = usages.reduce((s, u) => s + u.cpuRequest, 0);
  const totalCpuActual = usages.reduce((s, u) => s + u.cpuActual, 0);
  const totalEff = totalCpuReq > 0 ? ((totalCpuActual / totalCpuReq) * 100).toFixed(1) : "—";

  let result = formatTable(headers, rows);
  result += `\n\nTotal: ${formatCpu(totalCpuReq)} requested, ${formatCpu(totalCpuActual)} used (${totalEff}% efficiency)`;

  return result;
}

function formatOverUnder(
  usages: WorkloadUsage[],
  threshold: number,
  mode: "over" | "under"
): string {
  const filtered = usages.filter((u) => {
    if (u.cpuRequest === 0) return false;
    const ratio = u.cpuActual / u.cpuRequest;
    if (mode === "over") {
      return ratio < (1 - threshold / 100);
    }
    return ratio > (1 + threshold / 100);
  });

  if (filtered.length === 0) {
    return mode === "over"
      ? `No overprovisioned workloads found (threshold: ${threshold}%).`
      : `No underprovisioned workloads found (threshold: ${threshold}%).`;
  }

  const headers = ["WORKLOAD", "NAMESPACE", "CPU-REQ", "CPU-ACTUAL", "RATIO", "STATUS"];
  const rows = filtered.map((u) => {
    const workload = `${u.kind}/${u.name}`;
    const ratio = ((u.cpuActual / u.cpuRequest) * 100).toFixed(1);
    const status = mode === "over" ? "OVER" : "UNDER";
    return [workload, u.namespace, formatCpu(u.cpuRequest), formatCpu(u.cpuActual), `${ratio}%`, status];
  });

  return formatTable(headers, rows);
}

async function findIdleResources(
  clients: K8sClients,
  namespace: string,
  allNamespaces: boolean
): Promise<string> {
  const issues: string[] = [];

  const deployments = allNamespaces
    ? (await clients.appsApi.listDeploymentForAllNamespaces()).body.items
    : (await clients.appsApi.listNamespacedDeployment(namespace)).body.items;

  for (const dep of deployments) {
    if ((dep.spec?.replicas ?? 1) === 0) {
      issues.push(`[IDLE] Deployment ${dep.metadata?.namespace}/${dep.metadata?.name}: 0 replicas`);
    }
  }

  const jobs = allNamespaces
    ? (await clients.batchApi.listJobForAllNamespaces()).body.items
    : (await clients.batchApi.listNamespacedJob(namespace)).body.items;

  for (const job of jobs) {
    const succeeded = job.status?.succeeded ?? 0;
    const completionTime = job.status?.completionTime;
    if (succeeded > 0 && completionTime) {
      const completedAt = new Date(completionTime);
      const daysAgo = (Date.now() - completedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysAgo > 7) {
        issues.push(`[IDLE] Job ${job.metadata?.namespace}/${job.metadata?.name}: completed ${Math.floor(daysAgo)}d ago`);
      }
    }
  }

  const services = allNamespaces
    ? (await clients.coreApi.listServiceForAllNamespaces()).body.items
    : (await clients.coreApi.listNamespacedService(namespace)).body.items;

  const endpoints = allNamespaces
    ? (await clients.coreApi.listEndpointsForAllNamespaces()).body.items
    : (await clients.coreApi.listNamespacedEndpoints(namespace)).body.items;

  const epMap = new Map<string, number>();
  for (const ep of endpoints) {
    const key = `${ep.metadata?.namespace}/${ep.metadata?.name}`;
    const count = ep.subsets?.flatMap((s) => s.addresses || []).length || 0;
    epMap.set(key, count);
  }

  for (const svc of services) {
    if (svc.spec?.type === "ExternalName") continue;
    if (!svc.spec?.selector || Object.keys(svc.spec.selector).length === 0) continue;
    const key = `${svc.metadata?.namespace}/${svc.metadata?.name}`;
    if ((epMap.get(key) || 0) === 0) {
      issues.push(`[IDLE] Service ${key}: selector defined but no pods matched`);
    }
  }

  if (issues.length === 0) {
    return "No idle resources found.";
  }

  return `=== Idle Resources ===\n\n${issues.join("\n")}`;
}

function formatRecommendations(usages: WorkloadUsage[]): string {
  const recs: string[] = [];
  let recNum = 0;

  for (const u of usages) {
    if (u.cpuRequest === 0) continue;
    const ratio = u.cpuActual / u.cpuRequest;
    const workload = `${u.kind}/${u.name}`;

    if (ratio < 0.5 && u.cpuRequest > 100) {
      recNum++;
      const suggested = Math.max(Math.round(u.cpuActual * 1.3), 100);
      const savings = Math.round((1 - suggested / u.cpuRequest) * 100);
      recs.push(`  ${recNum}. [SAVE ${savings}%] ${workload}: reduce CPU request from ${formatCpu(u.cpuRequest)} to ${formatCpu(suggested)}`);
    } else if (ratio > 0.9) {
      recNum++;
      const suggested = Math.round(u.cpuActual * 1.3);
      recs.push(`  ${recNum}. [WARN] ${workload}: CPU at ${(ratio * 100).toFixed(0)}%, consider increasing request to ${formatCpu(suggested)}`);
    }
  }

  if (recs.length === 0) {
    return "No recommendations. All workloads are within reasonable resource usage.";
  }

  return `=== Recommendations ===\n\n${recs.join("\n")}`;
}

export async function handleK8sCost(
  params: K8sCostParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const clients = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";
    const allNs = params.all_namespaces ?? false;
    const threshold = params.threshold ?? 50;

    switch (params.action) {
      case "namespace_usage": {
        const usages = await getWorkloadUsages(clients, namespace, allNs);
        return formatNamespaceUsage(usages);
      }

      case "overprovisioned": {
        const usages = await getWorkloadUsages(clients, namespace, allNs);
        return formatOverUnder(usages, threshold, "over");
      }

      case "underprovisioned": {
        const usages = await getWorkloadUsages(clients, namespace, allNs);
        return formatOverUnder(usages, threshold, "under");
      }

      case "idle_resources": {
        return await findIdleResources(clients, namespace, allNs);
      }

      case "recommendations": {
        const usages = await getWorkloadUsages(clients, namespace, allNs);
        return formatRecommendations(usages);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `cost ${params.action}`));
  }
}

export function registerK8sCostTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_cost",
    description:
      "Kubernetes cost analysis: namespace usage, overprovisioned/underprovisioned detection, idle resources, rightsizing recommendations",
    schema: K8sCostSchema,
    handler: async (params: K8sCostParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sCost(params, pluginConfig);
    },
  });
}
