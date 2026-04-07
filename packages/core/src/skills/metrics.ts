import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { formatTable } from "../lib/format.js";
import { wrapK8sError } from "../lib/errors.js";
import type { PluginConfig } from "../lib/types.js";
import { DEFAULT_NAMESPACE } from "../lib/types.js";

export const K8sMetricsSchema = z.object({
  action: z.enum(["pod_resources", "node_resources", "top_pods", "top_nodes", "namespace_usage", "capacity_report"]),
  namespace: z.string().default(DEFAULT_NAMESPACE),
  pod_name: z.string().optional(),
  node_name: z.string().optional(),
  sort_by: z.enum(["cpu", "memory"]).default("cpu"),
  top_n: z.number().int().positive().default(10),
  context: z.string().optional(),
});

type K8sMetricsParams = z.infer<typeof K8sMetricsSchema>;

// --- Resource value parsing utilities ---

export function parseCpuValue(cpu: string): number {
  // Returns millicores
  if (cpu.endsWith("n")) return parseInt(cpu) / 1_000_000;
  if (cpu.endsWith("u")) return parseInt(cpu) / 1_000;
  if (cpu.endsWith("m")) return parseInt(cpu);
  return parseFloat(cpu) * 1000; // whole cores to millicores
}

export function parseMemoryValue(memory: string): number {
  // Returns bytes
  const units: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };

  for (const [suffix, multiplier] of Object.entries(units)) {
    if (memory.endsWith(suffix)) {
      return parseInt(memory.slice(0, -suffix.length)) * multiplier;
    }
  }
  return parseInt(memory); // raw bytes
}

export function formatCpu(millicores: number): string {
  if (millicores >= 1000) return `${(millicores / 1000).toFixed(1)} cores`;
  return `${Math.round(millicores)}m`;
}

export function formatMemory(bytes: number): string {
  const gi = 1024 ** 3;
  const mi = 1024 ** 2;
  if (bytes >= gi) return `${(bytes / gi).toFixed(1)}Gi`;
  return `${Math.round(bytes / mi)}Mi`;
}

function formatPercent(used: number, total: number): string {
  if (total === 0) return "N/A";
  return `${((used / total) * 100).toFixed(1)}%`;
}

// --- Metrics API types ---

interface PodMetricsItem {
  metadata: { name: string; namespace: string };
  timestamp: string;
  window: string;
  containers: Array<{
    name: string;
    usage: { cpu: string; memory: string };
  }>;
}

interface NodeMetricsItem {
  metadata: { name: string };
  timestamp: string;
  window: string;
  usage: { cpu: string; memory: string };
}

interface MetricsList<T> {
  kind: string;
  items: T[];
}

// --- Metrics fetching ---

async function fetchPodMetrics(
  kc: k8s.KubeConfig,
  namespace?: string,
  podName?: string
): Promise<PodMetricsItem[]> {
  const opts: Record<string, string> = {};
  await kc.applyToHTTPSOptions(opts as any);

  const server = kc.getCurrentCluster()?.server;
  if (!server) throw new Error("No cluster server found in kubeconfig");

  let url: string;
  if (podName && namespace) {
    url = `${server}/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods/${podName}`;
  } else if (namespace) {
    url = `${server}/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods`;
  } else {
    url = `${server}/apis/metrics.k8s.io/v1beta1/pods`;
  }

  const response = await kc.makeApiClient(k8s.CustomObjectsApi)
    .listClusterCustomObject("metrics.k8s.io", "v1beta1", "pods")
    .catch(() => {
      throw new Error("Metrics Server not available. Install it with: kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml");
    });

  const body = response.body as MetricsList<PodMetricsItem>;
  let items = body.items || [body as unknown as PodMetricsItem];

  if (namespace) {
    items = items.filter((item) => item.metadata.namespace === namespace);
  }
  if (podName) {
    items = items.filter((item) => item.metadata.name === podName);
  }

  return items;
}

async function fetchNamespacedPodMetrics(
  customApi: k8s.CustomObjectsApi,
  namespace: string
): Promise<PodMetricsItem[]> {
  try {
    const response = await customApi.listNamespacedCustomObject(
      "metrics.k8s.io", "v1beta1", namespace, "pods"
    );
    const body = response.body as MetricsList<PodMetricsItem>;
    return body.items || [];
  } catch {
    throw new Error("Metrics Server not available. Install it with: kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml");
  }
}

async function fetchNodeMetrics(
  customApi: k8s.CustomObjectsApi,
  nodeName?: string
): Promise<NodeMetricsItem[]> {
  try {
    const response = await customApi.listClusterCustomObject(
      "metrics.k8s.io", "v1beta1", "nodes"
    );
    const body = response.body as MetricsList<NodeMetricsItem>;
    let items = body.items || [];
    if (nodeName) {
      items = items.filter((item) => item.metadata.name === nodeName);
    }
    return items;
  } catch {
    throw new Error("Metrics Server not available. Install it with: kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml");
  }
}

// --- Handler ---

export async function handleK8sMetrics(params: K8sMetricsParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { kc, coreApi } = createK8sClients(pluginConfig, params.context);
    const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
    const namespace = params.namespace;

    switch (params.action) {
      case "pod_resources": {
        if (!params.pod_name) throw new Error("pod_name is required for pod_resources action");

        const metrics = await fetchNamespacedPodMetrics(customApi, namespace);
        const podMetrics = metrics.find((m) => m.metadata.name === params.pod_name);

        if (!podMetrics) return `No metrics found for pod ${namespace}/${params.pod_name}. Is Metrics Server running?`;

        let result = `Resource usage for ${namespace}/${params.pod_name}:\n\n`;

        const headers = ["CONTAINER", "CPU", "MEMORY"];
        let totalCpu = 0;
        let totalMem = 0;

        const rows = podMetrics.containers.map((c) => {
          const cpuMillis = parseCpuValue(c.usage.cpu);
          const memBytes = parseMemoryValue(c.usage.memory);
          totalCpu += cpuMillis;
          totalMem += memBytes;
          return [c.name, formatCpu(cpuMillis), formatMemory(memBytes)];
        });

        if (rows.length > 1) {
          rows.push(["TOTAL", formatCpu(totalCpu), formatMemory(totalMem)]);
        }

        result += formatTable(headers, rows);
        result += `\n\nTimestamp: ${podMetrics.timestamp}`;

        return result;
      }

      case "node_resources": {
        if (!params.node_name) throw new Error("node_name is required for node_resources action");

        const [metricsItems, nodeResponse] = await Promise.all([
          fetchNodeMetrics(customApi, params.node_name),
          coreApi.readNode(params.node_name),
        ]);

        if (metricsItems.length === 0) return `No metrics found for node ${params.node_name}`;

        const metrics = metricsItems[0];
        const node = nodeResponse.body;
        const capacity = node.status?.capacity || {};
        const allocatable = node.status?.allocatable || {};

        const cpuUsed = parseCpuValue(metrics.usage.cpu);
        const memUsed = parseMemoryValue(metrics.usage.memory);
        const cpuCapacity = parseCpuValue(capacity.cpu || "0");
        const memCapacity = parseMemoryValue(capacity.memory || "0");
        const cpuAllocatable = parseCpuValue(allocatable.cpu || "0");
        const memAllocatable = parseMemoryValue(allocatable.memory || "0");

        let result = `Node: ${params.node_name}\n\n`;
        result += formatTable(
          ["RESOURCE", "USED", "ALLOCATABLE", "CAPACITY", "USED%"],
          [
            ["CPU", formatCpu(cpuUsed), formatCpu(cpuAllocatable), formatCpu(cpuCapacity), formatPercent(cpuUsed, cpuAllocatable)],
            ["Memory", formatMemory(memUsed), formatMemory(memAllocatable), formatMemory(memCapacity), formatPercent(memUsed, memAllocatable)],
          ]
        );

        result += `\n\nPods: ${capacity.pods || "unknown"} (capacity)`;
        result += `\nTimestamp: ${metrics.timestamp}`;

        return result;
      }

      case "top_pods": {
        const metrics = await fetchNamespacedPodMetrics(customApi, namespace);

        if (metrics.length === 0) return `No pod metrics found in namespace ${namespace}`;

        const podStats = metrics.map((m) => {
          let totalCpu = 0;
          let totalMem = 0;
          for (const c of m.containers) {
            totalCpu += parseCpuValue(c.usage.cpu);
            totalMem += parseMemoryValue(c.usage.memory);
          }
          return { name: m.metadata.name, namespace: m.metadata.namespace, cpu: totalCpu, memory: totalMem };
        });

        podStats.sort((a, b) =>
          params.sort_by === "cpu" ? b.cpu - a.cpu : b.memory - a.memory
        );

        const top = podStats.slice(0, params.top_n);

        let result = `Top ${top.length} pods in ${namespace} by ${params.sort_by}:\n\n`;
        result += formatTable(
          ["#", "POD", "CPU", "MEMORY"],
          top.map((p, i) => [
            (i + 1).toString(),
            p.name,
            formatCpu(p.cpu),
            formatMemory(p.memory),
          ])
        );

        return result;
      }

      case "top_nodes": {
        const [metricsItems, nodesResponse] = await Promise.all([
          fetchNodeMetrics(customApi),
          coreApi.listNode(),
        ]);

        if (metricsItems.length === 0) return "No node metrics found";

        const nodeMap = new Map<string, k8s.V1Node>();
        for (const node of nodesResponse.body.items) {
          if (node.metadata?.name) nodeMap.set(node.metadata.name, node);
        }

        const nodeStats = metricsItems.map((m) => {
          const cpuUsed = parseCpuValue(m.usage.cpu);
          const memUsed = parseMemoryValue(m.usage.memory);
          const node = nodeMap.get(m.metadata.name);
          const cpuAllocatable = parseCpuValue(node?.status?.allocatable?.cpu || "0");
          const memAllocatable = parseMemoryValue(node?.status?.allocatable?.memory || "0");
          return {
            name: m.metadata.name,
            cpuUsed, memUsed,
            cpuAllocatable, memAllocatable,
            cpuPercent: cpuAllocatable > 0 ? (cpuUsed / cpuAllocatable) * 100 : 0,
            memPercent: memAllocatable > 0 ? (memUsed / memAllocatable) * 100 : 0,
          };
        });

        nodeStats.sort((a, b) =>
          params.sort_by === "cpu" ? b.cpuPercent - a.cpuPercent : b.memPercent - a.memPercent
        );

        const top = nodeStats.slice(0, params.top_n);

        let result = `Top ${top.length} nodes by ${params.sort_by}:\n\n`;
        result += formatTable(
          ["#", "NODE", "CPU USED", "CPU%", "MEM USED", "MEM%"],
          top.map((n, i) => [
            (i + 1).toString(),
            n.name,
            formatCpu(n.cpuUsed),
            `${n.cpuPercent.toFixed(1)}%`,
            formatMemory(n.memUsed),
            `${n.memPercent.toFixed(1)}%`,
          ])
        );

        return result;
      }

      case "namespace_usage": {
        const metrics = await fetchNamespacedPodMetrics(customApi, namespace);

        if (metrics.length === 0) return `No pod metrics found in namespace ${namespace}`;

        let totalCpu = 0;
        let totalMem = 0;
        let podCount = 0;

        const podDetails: Array<{ name: string; cpu: number; memory: number }> = [];

        for (const m of metrics) {
          let podCpu = 0;
          let podMem = 0;
          for (const c of m.containers) {
            podCpu += parseCpuValue(c.usage.cpu);
            podMem += parseMemoryValue(c.usage.memory);
          }
          totalCpu += podCpu;
          totalMem += podMem;
          podCount++;
          podDetails.push({ name: m.metadata.name, cpu: podCpu, memory: podMem });
        }

        let result = `Namespace: ${namespace}\n`;
        result += `Pods: ${podCount}\n`;
        result += `Total CPU: ${formatCpu(totalCpu)}\n`;
        result += `Total Memory: ${formatMemory(totalMem)}\n`;

        if (podCount > 0) {
          result += `Avg CPU/pod: ${formatCpu(totalCpu / podCount)}\n`;
          result += `Avg Memory/pod: ${formatMemory(totalMem / podCount)}\n`;
        }

        // Top 5 resource consumers
        podDetails.sort((a, b) => b.cpu - a.cpu);
        result += `\n--- Top 5 by CPU ---\n`;
        result += formatTable(
          ["POD", "CPU", "MEMORY"],
          podDetails.slice(0, 5).map((p) => [p.name, formatCpu(p.cpu), formatMemory(p.memory)])
        );

        podDetails.sort((a, b) => b.memory - a.memory);
        result += `\n\n--- Top 5 by Memory ---\n`;
        result += formatTable(
          ["POD", "CPU", "MEMORY"],
          podDetails.slice(0, 5).map((p) => [p.name, formatCpu(p.cpu), formatMemory(p.memory)])
        );

        return result;
      }

      case "capacity_report": {
        const [metricsItems, nodesResponse] = await Promise.all([
          fetchNodeMetrics(customApi),
          coreApi.listNode(),
        ]);

        const nodes = nodesResponse.body.items;
        const metricsMap = new Map<string, NodeMetricsItem>();
        for (const m of metricsItems) {
          metricsMap.set(m.metadata.name, m);
        }

        let totalCpuCapacity = 0;
        let totalCpuAllocatable = 0;
        let totalCpuUsed = 0;
        let totalMemCapacity = 0;
        let totalMemAllocatable = 0;
        let totalMemUsed = 0;
        let readyNodes = 0;
        let totalPodCapacity = 0;

        const nodeRows: string[][] = [];

        for (const node of nodes) {
          const name = node.metadata?.name || "unknown";
          const capacity = node.status?.capacity || {};
          const allocatable = node.status?.allocatable || {};
          const conditions = node.status?.conditions || [];
          const isReady = conditions.find((c) => c.type === "Ready")?.status === "True";
          if (isReady) readyNodes++;

          const cpuCap = parseCpuValue(capacity.cpu || "0");
          const cpuAlloc = parseCpuValue(allocatable.cpu || "0");
          const memCap = parseMemoryValue(capacity.memory || "0");
          const memAlloc = parseMemoryValue(allocatable.memory || "0");
          const podCap = parseInt(capacity.pods || "0");

          totalCpuCapacity += cpuCap;
          totalCpuAllocatable += cpuAlloc;
          totalMemCapacity += memCap;
          totalMemAllocatable += memAlloc;
          totalPodCapacity += podCap;

          const metrics = metricsMap.get(name);
          let cpuUsed = 0;
          let memUsed = 0;
          if (metrics) {
            cpuUsed = parseCpuValue(metrics.usage.cpu);
            memUsed = parseMemoryValue(metrics.usage.memory);
            totalCpuUsed += cpuUsed;
            totalMemUsed += memUsed;
          }

          nodeRows.push([
            name,
            isReady ? "Ready" : "NotReady",
            formatCpu(cpuUsed),
            formatCpu(cpuAlloc),
            formatPercent(cpuUsed, cpuAlloc),
            formatMemory(memUsed),
            formatMemory(memAlloc),
            formatPercent(memUsed, memAlloc),
          ]);
        }

        let result = `Cluster Capacity Report\n`;
        result += `${"=".repeat(50)}\n\n`;
        result += `Nodes: ${nodes.length} total, ${readyNodes} ready\n`;
        result += `Pod capacity: ${totalPodCapacity}\n\n`;

        result += `--- Cluster Totals ---\n`;
        result += formatTable(
          ["RESOURCE", "USED", "ALLOCATABLE", "CAPACITY", "USED%"],
          [
            ["CPU", formatCpu(totalCpuUsed), formatCpu(totalCpuAllocatable), formatCpu(totalCpuCapacity), formatPercent(totalCpuUsed, totalCpuAllocatable)],
            ["Memory", formatMemory(totalMemUsed), formatMemory(totalMemAllocatable), formatMemory(totalMemCapacity), formatPercent(totalMemUsed, totalMemAllocatable)],
          ]
        );

        result += `\n\n--- Per-Node Breakdown ---\n`;
        result += formatTable(
          ["NODE", "STATUS", "CPU USED", "CPU ALLOC", "CPU%", "MEM USED", "MEM ALLOC", "MEM%"],
          nodeRows
        );

        // Warnings
        const warnings: string[] = [];
        if (totalCpuAllocatable > 0 && (totalCpuUsed / totalCpuAllocatable) > 0.85) {
          warnings.push("CPU usage above 85% - consider adding nodes or optimizing workloads");
        }
        if (totalMemAllocatable > 0 && (totalMemUsed / totalMemAllocatable) > 0.85) {
          warnings.push("Memory usage above 85% - consider adding nodes or optimizing workloads");
        }
        if (readyNodes < nodes.length) {
          warnings.push(`${nodes.length - readyNodes} node(s) not ready`);
        }

        if (warnings.length > 0) {
          result += `\n\n--- Warnings ---\n`;
          warnings.forEach((w) => { result += `  ! ${w}\n`; });
        }

        return result;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `metrics ${params.action}`));
  }
}
