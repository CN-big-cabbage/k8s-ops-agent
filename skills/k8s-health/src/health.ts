import * as k8s from "@kubernetes/client-node";
import * as crypto from "crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients, type K8sClients } from "../../../lib/client.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";

export const K8sHealthSchema = z.object({
  action: z.enum(["cluster", "nodes", "workloads", "networking", "storage", "certificates"]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  context: z.string().optional(),
});

type K8sHealthParams = z.infer<typeof K8sHealthSchema>;

interface HealthIssue {
  level: "CRIT" | "WARN" | "INFO";
  message: string;
}

interface CheckResult {
  name: string;
  score: number;
  maxScore: number;
  issues: HealthIssue[];
}

function progressBar(score: number, maxScore: number): string {
  const ratio = maxScore > 0 ? score / maxScore : 1;
  const filled = Math.round(ratio * 10);
  const empty = 10 - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

function formatCheckResult(check: CheckResult): string {
  const bar = progressBar(check.score, check.maxScore);
  let result = `[${check.name}] ${bar} ${check.score}/${check.maxScore}  (${check.issues.length} issues)\n`;

  for (const issue of check.issues) {
    result += `  [${issue.level}] ${issue.message}\n`;
  }

  return result;
}

function formatClusterReport(checks: CheckResult[]): string {
  const totalScore = checks.reduce((sum, c) => sum + c.score, 0);
  const totalMax = checks.reduce((sum, c) => sum + c.maxScore, 0);
  const overallScore = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 100;

  let result = `=== Cluster Health Report ===\n`;
  result += `Overall Score: ${overallScore}/100\n\n`;

  for (const check of checks) {
    result += formatCheckResult(check);
    result += "\n";
  }

  return result.trimEnd();
}

async function checkNodes(clients: K8sClients): Promise<CheckResult> {
  const response = await clients.coreApi.listNode();
  const nodes = response.body.items;
  const issues: HealthIssue[] = [];
  const maxScore = 10;

  for (const node of nodes) {
    const name = node.metadata?.name || "unknown";
    const conditions = node.status?.conditions || [];

    const ready = conditions.find((c) => c.type === "Ready");
    if (!ready || ready.status !== "True") {
      issues.push({ level: "CRIT", message: `${name}: NotReady` });
    }

    const pressureConditions = ["MemoryPressure", "DiskPressure", "PIDPressure"];
    for (const pType of pressureConditions) {
      const cond = conditions.find((c) => c.type === pType);
      if (cond && cond.status === "True") {
        issues.push({ level: "WARN", message: `${name}: ${pType}=True` });
      }
    }

    if (node.spec?.unschedulable) {
      issues.push({ level: "WARN", message: `${name}: cordoned (unschedulable)` });
    }
  }

  const critCount = issues.filter((i) => i.level === "CRIT").length;
  const warnCount = issues.filter((i) => i.level === "WARN").length;
  const score = Math.max(0, maxScore - critCount * 3 - warnCount);

  return { name: "Nodes", score, maxScore, issues };
}

async function checkWorkloads(
  clients: K8sClients,
  namespace?: string,
  allNamespaces?: boolean
): Promise<CheckResult> {
  const issues: HealthIssue[] = [];
  const maxScore = 10;

  const deployments = allNamespaces
    ? (await clients.appsApi.listDeploymentForAllNamespaces()).body.items
    : (await clients.appsApi.listNamespacedDeployment(namespace || "default")).body.items;

  for (const dep of deployments) {
    const name = `${dep.metadata?.namespace}/${dep.metadata?.name}`;
    const desired = dep.spec?.replicas ?? 1;
    const ready = dep.status?.readyReplicas ?? 0;
    if (ready < desired) {
      issues.push({
        level: ready === 0 ? "CRIT" : "WARN",
        message: `${name}: ${ready}/${desired} replicas ready`,
      });
    }
  }

  const statefulsets = allNamespaces
    ? (await clients.appsApi.listStatefulSetForAllNamespaces()).body.items
    : (await clients.appsApi.listNamespacedStatefulSet(namespace || "default")).body.items;

  for (const ss of statefulsets) {
    const name = `${ss.metadata?.namespace}/${ss.metadata?.name}`;
    const desired = ss.spec?.replicas ?? 1;
    const ready = ss.status?.readyReplicas ?? 0;
    if (ready < desired) {
      issues.push({
        level: ready === 0 ? "CRIT" : "WARN",
        message: `${name}: ${ready}/${desired} replicas ready`,
      });
    }
  }

  const pods = allNamespaces
    ? (await clients.coreApi.listPodForAllNamespaces()).body.items
    : (await clients.coreApi.listNamespacedPod(namespace || "default")).body.items;

  for (const pod of pods) {
    const name = `${pod.metadata?.namespace}/${pod.metadata?.name}`;
    const containerStatuses = pod.status?.containerStatuses || [];
    for (const cs of containerStatuses) {
      if (cs.state?.waiting?.reason === "CrashLoopBackOff") {
        issues.push({ level: "CRIT", message: `${name}: CrashLoopBackOff (${cs.name})` });
      } else if (cs.state?.waiting?.reason === "ImagePullBackOff") {
        issues.push({ level: "WARN", message: `${name}: ImagePullBackOff (${cs.name})` });
      }
    }
  }

  const critCount = issues.filter((i) => i.level === "CRIT").length;
  const warnCount = issues.filter((i) => i.level === "WARN").length;
  const score = Math.max(0, maxScore - critCount * 3 - warnCount);

  return { name: "Workloads", score, maxScore, issues };
}

async function checkNetworking(
  clients: K8sClients,
  namespace?: string,
  allNamespaces?: boolean
): Promise<CheckResult> {
  const issues: HealthIssue[] = [];
  const maxScore = 10;
  const ns = namespace || "default";

  const services = allNamespaces
    ? (await clients.coreApi.listServiceForAllNamespaces()).body.items
    : (await clients.coreApi.listNamespacedService(ns)).body.items;

  const endpoints = allNamespaces
    ? (await clients.coreApi.listEndpointsForAllNamespaces()).body.items
    : (await clients.coreApi.listNamespacedEndpoints(ns)).body.items;

  const endpointMap = new Map<string, k8s.V1Endpoints>();
  for (const ep of endpoints) {
    const key = `${ep.metadata?.namespace}/${ep.metadata?.name}`;
    endpointMap.set(key, ep);
  }

  for (const svc of services) {
    if (svc.spec?.type === "ExternalName") continue;
    const svcKey = `${svc.metadata?.namespace}/${svc.metadata?.name}`;

    if (svc.spec?.selector && Object.keys(svc.spec.selector).length > 0) {
      const ep = endpointMap.get(svcKey);
      const addresses = ep?.subsets?.flatMap((s) => s.addresses || []) || [];
      if (addresses.length === 0) {
        issues.push({ level: "WARN", message: `Service ${svcKey}: no ready endpoints` });
      }
    }
  }

  const ingresses = allNamespaces
    ? (await clients.networkingApi.listIngressForAllNamespaces()).body.items
    : (await clients.networkingApi.listNamespacedIngress(ns)).body.items;

  for (const ing of ingresses) {
    const ingName = `${ing.metadata?.namespace}/${ing.metadata?.name}`;
    const rules = ing.spec?.rules || [];
    for (const rule of rules) {
      const paths = rule.http?.paths || [];
      for (const path of paths) {
        const backend = path.backend?.service;
        if (backend) {
          const svcKey = `${ing.metadata?.namespace}/${backend.name}`;
          if (!endpointMap.has(svcKey)) {
            issues.push({ level: "WARN", message: `Ingress ${ingName}: backend ${backend.name} has no endpoints` });
          }
        }
      }
    }
  }

  const warnCount = issues.filter((i) => i.level === "WARN").length;
  const score = Math.max(0, maxScore - warnCount);

  return { name: "Network", score, maxScore, issues };
}

async function checkStorage(clients: K8sClients): Promise<CheckResult> {
  const issues: HealthIssue[] = [];
  const maxScore = 10;

  const pvcs = (await clients.coreApi.listPersistentVolumeClaimForAllNamespaces()).body.items;

  for (const pvc of pvcs) {
    const name = `${pvc.metadata?.namespace}/${pvc.metadata?.name}`;
    if (pvc.status?.phase !== "Bound") {
      issues.push({ level: "WARN", message: `pvc/${name}: ${pvc.status?.phase || "Unknown"} (not Bound)` });
    }
  }

  const pvs = (await clients.coreApi.listPersistentVolume()).body.items;

  for (const pv of pvs) {
    const name = pv.metadata?.name || "unknown";
    if (pv.status?.phase === "Released") {
      issues.push({ level: "INFO", message: `pv/${name}: Released, not reclaimed` });
    } else if (pv.status?.phase === "Failed") {
      issues.push({ level: "WARN", message: `pv/${name}: Failed` });
    }
  }

  const critCount = issues.filter((i) => i.level === "CRIT").length;
  const warnCount = issues.filter((i) => i.level === "WARN").length;
  const score = Math.max(0, maxScore - critCount * 3 - warnCount);

  return { name: "Storage", score, maxScore, issues };
}

export function parseCertExpiry(certData: string): Date | null {
  try {
    const certBuffer = Buffer.from(certData, "base64");
    const certPem = certBuffer.toString("utf-8");

    const x509 = new crypto.X509Certificate(certPem);
    return new Date(x509.validTo);
  } catch {
    return null;
  }
}

async function checkCertificates(
  clients: K8sClients,
  namespace?: string,
  allNamespaces?: boolean
): Promise<CheckResult> {
  const issues: HealthIssue[] = [];
  const maxScore = 10;
  const ns = namespace || "default";

  const secrets = allNamespaces
    ? (await clients.coreApi.listSecretForAllNamespaces()).body.items
    : (await clients.coreApi.listNamespacedSecret(ns)).body.items;

  const tlsSecrets = secrets.filter((s) => s.type === "kubernetes.io/tls");
  const now = new Date();

  for (const secret of tlsSecrets) {
    const name = `${secret.metadata?.namespace}/${secret.metadata?.name}`;
    const certData = secret.data?.["tls.crt"];
    if (!certData) continue;

    const expiry = parseCertExpiry(certData);
    if (!expiry) continue;

    const daysUntilExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry <= 0) {
      issues.push({ level: "CRIT", message: `secret/${name}: certificate EXPIRED (${daysUntilExpiry}d ago)` });
    } else if (daysUntilExpiry <= 7) {
      issues.push({ level: "CRIT", message: `secret/${name}: expires in ${daysUntilExpiry} days` });
    } else if (daysUntilExpiry <= 30) {
      issues.push({ level: "WARN", message: `secret/${name}: expires in ${daysUntilExpiry} days` });
    }
  }

  const critCount = issues.filter((i) => i.level === "CRIT").length;
  const warnCount = issues.filter((i) => i.level === "WARN").length;
  const score = Math.max(0, maxScore - critCount * 3 - warnCount);

  return { name: "Certs", score, maxScore, issues };
}

export async function handleK8sHealth(
  params: K8sHealthParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const clients = createK8sClients(pluginConfig, params.context);

    switch (params.action) {
      case "cluster": {
        const checks = await Promise.all([
          checkNodes(clients),
          checkWorkloads(clients, params.namespace, params.all_namespaces ?? true),
          checkNetworking(clients, params.namespace, params.all_namespaces ?? true),
          checkStorage(clients),
          checkCertificates(clients, params.namespace, params.all_namespaces ?? true),
        ]);
        return formatClusterReport(checks);
      }

      case "nodes": {
        const check = await checkNodes(clients);
        return formatCheckResult(check);
      }

      case "workloads": {
        const check = await checkWorkloads(clients, params.namespace, params.all_namespaces);
        return formatCheckResult(check);
      }

      case "networking": {
        const check = await checkNetworking(clients, params.namespace, params.all_namespaces);
        return formatCheckResult(check);
      }

      case "storage": {
        const check = await checkStorage(clients);
        return formatCheckResult(check);
      }

      case "certificates": {
        const check = await checkCertificates(clients, params.namespace, params.all_namespaces);
        return formatCheckResult(check);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `health ${params.action}`));
  }
}

export function registerK8sHealthTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_health",
    description:
      "Kubernetes cluster health check: cluster overview, node health, workload health, networking, storage, certificate expiry",
    schema: K8sHealthSchema,
    handler: async (params: K8sHealthParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sHealth(params, pluginConfig);
    },
  });
}
