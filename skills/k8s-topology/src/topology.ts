import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients, type K8sClients } from "../../../lib/client.js";
import { formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";

export const K8sTopologySchema = z.object({
  action: z.enum(["service_chain", "workload_chain", "pod_dependencies", "namespace_map"]),
  namespace: z.string().optional(),
  name: z.string().optional(),
  pod_name: z.string().optional(),
  context: z.string().optional(),
});

type K8sTopologyParams = z.infer<typeof K8sTopologySchema>;

async function serviceChain(
  clients: K8sClients,
  name: string,
  namespace: string
): Promise<string> {
  const svcResp = await clients.coreApi.readNamespacedService(name, namespace);
  const svc = svcResp.body;
  const clusterIP = svc.spec?.clusterIP || "None";
  const svcType = svc.spec?.type || "ClusterIP";

  let result = `Service: ${namespace}/${name} (${svcType}: ${clusterIP})\n`;

  const epResp = await clients.coreApi.readNamespacedEndpoints(name, namespace);
  const subsets = epResp.body.subsets || [];

  if (subsets.length === 0) {
    result += `\u2514\u2500\u2500 (no endpoints)\n`;
    return result;
  }

  const allAddresses: Array<{ ip: string; port: number; targetRef?: k8s.V1ObjectReference }> = [];

  for (const subset of subsets) {
    const ports = subset.ports || [];
    const addresses = subset.addresses || [];
    for (const addr of addresses) {
      const port = ports[0]?.port || 0;
      allAddresses.push({ ip: addr.ip || "—", port, targetRef: addr.targetRef });
    }
  }

  const podNames = allAddresses
    .filter((a) => a.targetRef?.kind === "Pod")
    .map((a) => a.targetRef!.name!);

  const pods = new Map<string, k8s.V1Pod>();
  for (const podName of podNames) {
    try {
      const podResp = await clients.coreApi.readNamespacedPod(podName, namespace);
      pods.set(podName, podResp.body);
    } catch {
      // Pod may no longer exist
    }
  }

  for (let i = 0; i < allAddresses.length; i++) {
    const addr = allAddresses[i];
    const isLast = i === allAddresses.length - 1;
    const prefix = isLast ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
    const childPrefix = isLast ? "    " : "\u2502   ";

    result += `${prefix} Endpoint: ${addr.ip}:${addr.port}\n`;

    if (addr.targetRef?.kind === "Pod" && addr.targetRef.name) {
      const pod = pods.get(addr.targetRef.name);
      const phase = pod?.status?.phase || "Unknown";
      const nodeName = pod?.spec?.nodeName || "unknown";
      result += `${childPrefix}\u2514\u2500\u2500 Pod: ${addr.targetRef.name} (${phase}) [${nodeName}]\n`;
    }
  }

  return result;
}

async function workloadChain(
  clients: K8sClients,
  name: string,
  namespace: string
): Promise<string> {
  let workloadKind = "";
  let selector: Record<string, string> = {};
  let readyInfo = "";

  try {
    const dep = await clients.appsApi.readNamespacedDeployment(name, namespace);
    workloadKind = "Deployment";
    selector = dep.body.spec?.selector?.matchLabels || {};
    const desired = dep.body.spec?.replicas ?? 1;
    const ready = dep.body.status?.readyReplicas ?? 0;
    readyInfo = `${ready}/${desired} ready`;
  } catch {
    try {
      const ss = await clients.appsApi.readNamespacedStatefulSet(name, namespace);
      workloadKind = "StatefulSet";
      selector = ss.body.spec?.selector?.matchLabels || {};
      const desired = ss.body.spec?.replicas ?? 1;
      const ready = ss.body.status?.readyReplicas ?? 0;
      readyInfo = `${ready}/${desired} ready`;
    } catch {
      try {
        const ds = await clients.appsApi.readNamespacedDaemonSet(name, namespace);
        workloadKind = "DaemonSet";
        selector = ds.body.spec?.selector?.matchLabels || {};
        const desired = ds.body.status?.desiredNumberScheduled ?? 0;
        const ready = ds.body.status?.numberReady ?? 0;
        readyInfo = `${ready}/${desired} ready`;
      } catch {
        throw new Error(`Workload "${name}" not found as Deployment, StatefulSet, or DaemonSet in ${namespace}`);
      }
    }
  }

  let result = `${workloadKind}: ${namespace}/${name} (${readyInfo})\n`;

  const labelSelector = Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(",");

  if (workloadKind === "Deployment") {
    const rsResp = await clients.appsApi.listNamespacedReplicaSet(
      namespace, undefined, undefined, undefined, undefined, labelSelector
    );
    const replicaSets = rsResp.body.items
      .filter((rs) => (rs.status?.replicas ?? 0) > 0)
      .sort((a, b) => (b.status?.replicas ?? 0) - (a.status?.replicas ?? 0));

    for (let ri = 0; ri < replicaSets.length; ri++) {
      const rs = replicaSets[ri];
      const rsName = rs.metadata?.name || "unknown";
      const rsReplicas = rs.status?.replicas ?? 0;
      const rsReady = rs.status?.readyReplicas ?? 0;
      const isLastRs = ri === replicaSets.length - 1;
      const rsPrefix = isLastRs ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";
      const rsChildPrefix = isLastRs ? "    " : "\u2502   ";

      result += `${rsPrefix} ReplicaSet: ${rsName} (${rsReady}/${rsReplicas})\n`;

      const podResp = await clients.coreApi.listNamespacedPod(
        namespace, undefined, undefined, undefined, undefined, labelSelector
      );
      const rsPods = podResp.body.items.filter((pod) => {
        const ownerRefs = pod.metadata?.ownerReferences || [];
        return ownerRefs.some((ref) => ref.name === rsName && ref.kind === "ReplicaSet");
      });

      for (let pi = 0; pi < rsPods.length; pi++) {
        const pod = rsPods[pi];
        const podName = pod.metadata?.name || "unknown";
        const phase = pod.status?.phase || "Unknown";
        const nodeName = pod.spec?.nodeName || "unknown";
        const isLastPod = pi === rsPods.length - 1;
        const podPrefix = isLastPod ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";

        result += `${rsChildPrefix}${podPrefix} Pod: ${podName} (${phase}) [${nodeName}]\n`;
      }
    }
  } else {
    const podResp = await clients.coreApi.listNamespacedPod(
      namespace, undefined, undefined, undefined, undefined, labelSelector
    );

    for (let pi = 0; pi < podResp.body.items.length; pi++) {
      const pod = podResp.body.items[pi];
      const podName = pod.metadata?.name || "unknown";
      const phase = pod.status?.phase || "Unknown";
      const nodeName = pod.spec?.nodeName || "unknown";
      const isLastPod = pi === podResp.body.items.length - 1;
      const podPrefix = isLastPod ? "\u2514\u2500\u2500" : "\u251C\u2500\u2500";

      result += `${podPrefix} Pod: ${podName} (${phase}) [${nodeName}]\n`;
    }
  }

  return result;
}

async function podDependencies(
  clients: K8sClients,
  podName: string,
  namespace: string
): Promise<string> {
  const podResp = await clients.coreApi.readNamespacedPod(podName, namespace);
  const pod = podResp.body;
  const phase = pod.status?.phase || "Unknown";
  const nodeName = pod.spec?.nodeName || "unknown";

  let result = `Pod: ${namespace}/${podName} (${phase}) [${nodeName}]\n`;

  const deps: Array<{ kind: string; name: string; status: string }> = [];

  const volumes = pod.spec?.volumes || [];
  for (const vol of volumes) {
    if (vol.configMap) {
      deps.push({ kind: "ConfigMap", name: vol.configMap.name || "unknown", status: "mounted" });
    }
    if (vol.secret) {
      deps.push({ kind: "Secret", name: vol.secret.secretName || "unknown", status: "mounted" });
    }
    if (vol.persistentVolumeClaim) {
      deps.push({ kind: "PVC", name: vol.persistentVolumeClaim.claimName || "unknown", status: "mounted" });
    }
  }

  const containers = [...(pod.spec?.containers || []), ...(pod.spec?.initContainers || [])];
  for (const container of containers) {
    const envFrom = container.envFrom || [];
    for (const ef of envFrom) {
      if (ef.configMapRef) {
        const name = ef.configMapRef.name || "unknown";
        if (!deps.some((d) => d.kind === "ConfigMap" && d.name === name)) {
          deps.push({ kind: "ConfigMap", name, status: "envFrom" });
        }
      }
      if (ef.secretRef) {
        const name = ef.secretRef.name || "unknown";
        if (!deps.some((d) => d.kind === "Secret" && d.name === name)) {
          deps.push({ kind: "Secret", name, status: "envFrom" });
        }
      }
    }

    const envVars = container.env || [];
    for (const env of envVars) {
      if (env.valueFrom?.configMapKeyRef) {
        const name = env.valueFrom.configMapKeyRef.name || "unknown";
        if (!deps.some((d) => d.kind === "ConfigMap" && d.name === name)) {
          deps.push({ kind: "ConfigMap", name, status: "envRef" });
        }
      }
      if (env.valueFrom?.secretKeyRef) {
        const name = env.valueFrom.secretKeyRef.name || "unknown";
        if (!deps.some((d) => d.kind === "Secret" && d.name === name)) {
          deps.push({ kind: "Secret", name, status: "envRef" });
        }
      }
    }
  }

  const sa = pod.spec?.serviceAccountName || pod.spec?.serviceAccount;
  if (sa) {
    deps.push({ kind: "ServiceAccount", name: sa, status: "bound" });
  }

  if (deps.length === 0) {
    result += "  (no dependencies found)\n";
  } else {
    const headers = ["KIND", "NAME", "SOURCE"];
    const rows = deps.map((d) => [d.kind, d.name, d.status]);
    result += formatTable(headers, rows);
  }

  return result;
}

async function namespaceMap(
  clients: K8sClients,
  namespace: string
): Promise<string> {
  const [deployResp, ssResp, dsResp, svcResp, ingressResp, cmResp, secretResp, pvcResp, podResp] =
    await Promise.all([
      clients.appsApi.listNamespacedDeployment(namespace),
      clients.appsApi.listNamespacedStatefulSet(namespace),
      clients.appsApi.listNamespacedDaemonSet(namespace),
      clients.coreApi.listNamespacedService(namespace),
      clients.networkingApi.listNamespacedIngress(namespace),
      clients.coreApi.listNamespacedConfigMap(namespace),
      clients.coreApi.listNamespacedSecret(namespace),
      clients.coreApi.listNamespacedPersistentVolumeClaim(namespace),
      clients.coreApi.listNamespacedPod(namespace),
    ]);

  const counts: Array<[string, number]> = [
    ["Deployments", deployResp.body.items.length],
    ["StatefulSets", ssResp.body.items.length],
    ["DaemonSets", dsResp.body.items.length],
    ["Pods", podResp.body.items.length],
    ["Services", svcResp.body.items.length],
    ["Ingresses", ingressResp.body.items.length],
    ["ConfigMaps", cmResp.body.items.length],
    ["Secrets", secretResp.body.items.length],
    ["PVCs", pvcResp.body.items.length],
  ];

  let result = `=== Namespace: ${namespace} ===\n\n`;

  const headers = ["RESOURCE", "COUNT"];
  const rows = counts.map(([resource, count]) => [resource, String(count)]);
  result += formatTable(headers, rows);

  const runningPods = podResp.body.items.filter((p) => p.status?.phase === "Running").length;
  const pendingPods = podResp.body.items.filter((p) => p.status?.phase === "Pending").length;
  const failedPods = podResp.body.items.filter(
    (p) => p.status?.phase === "Failed" || p.status?.phase === "Unknown"
  ).length;

  result += `\n\nPod Status: ${runningPods} Running, ${pendingPods} Pending, ${failedPods} Failed/Unknown`;

  return result;
}

export async function handleK8sTopology(
  params: K8sTopologyParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const clients = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "service_chain": {
        if (!params.name) {
          throw new Error("name is required for service_chain action");
        }
        return await serviceChain(clients, params.name, namespace);
      }

      case "workload_chain": {
        if (!params.name) {
          throw new Error("name is required for workload_chain action");
        }
        return await workloadChain(clients, params.name, namespace);
      }

      case "pod_dependencies": {
        if (!params.pod_name) {
          throw new Error("pod_name is required for pod_dependencies action");
        }
        return await podDependencies(clients, params.pod_name, namespace);
      }

      case "namespace_map": {
        return await namespaceMap(clients, namespace);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `topology ${params.action}`));
  }
}

export function registerK8sTopologyTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_topology",
    description:
      "Kubernetes resource topology: service chain, workload chain, pod dependencies, namespace map",
    schema: K8sTopologySchema,
    handler: async (params: K8sTopologyParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sTopology(params, pluginConfig);
    },
  });
}
