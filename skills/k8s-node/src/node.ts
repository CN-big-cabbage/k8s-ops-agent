import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatAge, formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";

// Zod schema for k8s_node tool parameters
const K8sNodeSchema = z.object({
  action: z.enum([
    "list",
    "describe",
    "status",
    "cordon",
    "uncordon",
    "drain",
    "get_taints",
    "taint",
    "remove_taint",
    "label",
  ]),
  node_name: z.string().optional(),
  label_selector: z.string().optional(),
  // Drain options
  ignore_daemonsets: z.boolean().optional(),
  delete_emptydir_data: z.boolean().optional(),
  force: z.boolean().optional(),
  grace_period: z.number().int().positive().optional(),
  // Taint options
  key: z.string().optional(),
  value: z.string().optional(),
  effect: z.enum(["NoSchedule", "PreferNoSchedule", "NoExecute"]).optional(),
  // Label options
  labels: z.record(z.string()).optional(),
  context: z.string().optional(),
});

type K8sNodeParams = z.infer<typeof K8sNodeSchema>;

function formatNodeList(nodes: k8s.V1Node[]): string {
  if (nodes.length === 0) {
    return "No nodes found.";
  }

  const headers = ["NAME", "STATUS", "ROLES", "AGE", "VERSION"];
  const rows = nodes.map((node) => {
    const name = node.metadata?.name || "unknown";

    const conditions = node.status?.conditions || [];
    const readyCondition = conditions.find((c) => c.type === "Ready");
    const status = readyCondition?.status === "True" ? "Ready" : "NotReady";

    const labels = node.metadata?.labels || {};
    const roles: string[] = [];
    Object.keys(labels).forEach((key) => {
      if (key.startsWith("node-role.kubernetes.io/")) {
        const role = key.replace("node-role.kubernetes.io/", "");
        roles.push(role);
      }
    });
    const rolesStr = roles.length > 0 ? roles.join(",") : "<none>";

    const creationTime = node.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";

    const version = node.status?.nodeInfo?.kubeletVersion || "unknown";

    return [name, status, rolesStr, age, version];
  });

  return formatTable(headers, rows);
}

function formatNodeStatus(node: k8s.V1Node): string {
  const name = node.metadata?.name || "unknown";

  let result = `Node: ${name}\n`;

  const conditions = node.status?.conditions || [];
  result += `\n--- Conditions ---\n`;
  conditions.forEach((c) => {
    const icon = c.status === "True" ? "✓" : c.status === "False" ? "✗" : "?";
    result += `  ${icon} ${c.type}: ${c.status}`;
    if (c.reason) {
      result += ` (${c.reason})`;
    }
    result += "\n";
  });

  const unschedulable = node.spec?.unschedulable;
  result += `\nSchedulable: ${unschedulable ? "No (Cordoned)" : "Yes"}\n`;

  result += `\n--- Resource Capacity ---\n`;
  const capacity = node.status?.capacity || {};
  result += `  CPU: ${capacity.cpu || "unknown"}\n`;
  result += `  Memory: ${capacity.memory || "unknown"}\n`;
  result += `  Pods: ${capacity.pods || "unknown"}\n`;

  result += `\n--- Allocatable ---\n`;
  const allocatable = node.status?.allocatable || {};
  result += `  CPU: ${allocatable.cpu || "unknown"}\n`;
  result += `  Memory: ${allocatable.memory || "unknown"}\n`;
  result += `  Pods: ${allocatable.pods || "unknown"}\n`;

  const taints = node.spec?.taints || [];
  if (taints.length > 0) {
    result += `\n--- Taints ---\n`;
    taints.forEach((t) => {
      result += `  ${t.key}=${t.value || ""}:${t.effect}\n`;
    });
  }

  return result;
}

function formatNodeDescribe(node: k8s.V1Node, pods?: k8s.V1Pod[]): string {
  const name = node.metadata?.name || "unknown";

  let result = `Name: ${name}\n`;
  result += `CreationTimestamp: ${node.metadata?.creationTimestamp || "unknown"}\n`;

  result += `\n--- Labels ---\n`;
  const labels = node.metadata?.labels || {};
  Object.entries(labels).forEach(([k, v]) => {
    result += `  ${k}: ${v}\n`;
  });

  result += `\n--- Annotations ---\n`;
  const annotations = node.metadata?.annotations || {};
  const importantAnnotations = [
    "kubeadm.alpha.kubernetes.io/cri-socket",
    "node.alpha.kubernetes.io/ttl",
    "volumes.kubernetes.io/controller-managed-attach-detach",
  ];
  importantAnnotations.forEach((key) => {
    if (annotations[key]) {
      result += `  ${key}: ${annotations[key]}\n`;
    }
  });

  result += `\n--- Taints ---\n`;
  const taints = node.spec?.taints || [];
  if (taints.length === 0) {
    result += `  <none>\n`;
  } else {
    taints.forEach((t) => {
      result += `  ${t.key}=${t.value || ""}:${t.effect}\n`;
    });
  }

  result += `\n--- Conditions ---\n`;
  const conditions = node.status?.conditions || [];
  conditions.forEach((c) => {
    result += `  ${c.type}: ${c.status}`;
    if (c.reason) {
      result += ` (${c.reason})`;
    }
    if (c.message) {
      result += `\n    Message: ${c.message}`;
    }
    result += "\n";
  });

  result += `\n--- Addresses ---\n`;
  const addresses = node.status?.addresses || [];
  addresses.forEach((addr) => {
    result += `  ${addr.type}: ${addr.address}\n`;
  });

  result += `\n--- Capacity ---\n`;
  const capacity = node.status?.capacity || {};
  Object.entries(capacity).forEach(([k, v]) => {
    result += `  ${k}: ${v}\n`;
  });

  result += `\n--- Allocatable ---\n`;
  const allocatable = node.status?.allocatable || {};
  Object.entries(allocatable).forEach(([k, v]) => {
    result += `  ${k}: ${v}\n`;
  });

  result += `\n--- System Info ---\n`;
  const nodeInfo = node.status?.nodeInfo;
  if (nodeInfo) {
    result += `  OS: ${nodeInfo.operatingSystem} ${nodeInfo.osImage}\n`;
    result += `  Kernel: ${nodeInfo.kernelVersion}\n`;
    result += `  Container Runtime: ${nodeInfo.containerRuntimeVersion}\n`;
    result += `  Kubelet: ${nodeInfo.kubeletVersion}\n`;
    result += `  Kube-Proxy: ${nodeInfo.kubeProxyVersion}\n`;
  }

  if (pods && pods.length > 0) {
    result += `\n--- Pods on Node (${pods.length}) ---\n`;
    pods.slice(0, 20).forEach((pod) => {
      const podName = pod.metadata?.name || "unknown";
      const podNamespace = pod.metadata?.namespace || "unknown";
      const podPhase = pod.status?.phase || "Unknown";
      result += `  ${podNamespace}/${podName} (${podPhase})\n`;
    });
    if (pods.length > 20) {
      result += `  ... and ${pods.length - 20} more pods\n`;
    }
  }

  return result;
}

async function handleK8sNode(params: K8sNodeParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi } = createK8sClients(pluginConfig, params.context);

    switch (params.action) {
      case "list": {
        const response = await coreApi.listNode(
          undefined,
          undefined,
          undefined,
          undefined,
          params.label_selector
        );
        return formatNodeList(response.body.items);
      }

      case "status": {
        if (!params.node_name) {
          throw new Error("node_name is required for status action");
        }

        const response = await coreApi.readNode(params.node_name);
        return formatNodeStatus(response.body);
      }

      case "describe": {
        if (!params.node_name) {
          throw new Error("node_name is required for describe action");
        }

        const nodeResponse = await coreApi.readNode(params.node_name);

        // Get pods on this node
        let pods: k8s.V1Pod[] = [];
        try {
          const podsResponse = await coreApi.listPodForAllNamespaces(
            undefined,
            undefined,
            `spec.nodeName=${params.node_name}`
          );
          pods = podsResponse.body.items;
        } catch (err) {
          // Continue without pods
        }

        return formatNodeDescribe(nodeResponse.body, pods);
      }

      case "cordon": {
        if (!params.node_name) {
          throw new Error("node_name is required for cordon action");
        }

        const patch = {
          spec: {
            unschedulable: true,
          },
        };

        await coreApi.patchNode(
          params.node_name,
          patch,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            headers: { "Content-Type": "application/strategic-merge-patch+json" },
          }
        );

        return `Node ${params.node_name} cordoned (marked as unschedulable)`;
      }

      case "uncordon": {
        if (!params.node_name) {
          throw new Error("node_name is required for uncordon action");
        }

        const patch = {
          spec: {
            unschedulable: false,
          },
        };

        await coreApi.patchNode(
          params.node_name,
          patch,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            headers: { "Content-Type": "application/strategic-merge-patch+json" },
          }
        );

        return `Node ${params.node_name} uncordoned (marked as schedulable)`;
      }

      case "drain": {
        if (!params.node_name) {
          throw new Error("node_name is required for drain action");
        }

        // First, cordon the node
        await coreApi.patchNode(
          params.node_name,
          { spec: { unschedulable: true } },
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            headers: { "Content-Type": "application/strategic-merge-patch+json" },
          }
        );

        // Get all pods on the node
        const podsResponse = await coreApi.listPodForAllNamespaces(
          undefined,
          undefined,
          `spec.nodeName=${params.node_name}`
        );

        const pods = podsResponse.body.items;
        const ignoreDaemonsets = params.ignore_daemonsets !== false; // default true
        const deleteEmptyDir = params.delete_emptydir_data !== false; // default true

        const evictedPods: string[] = [];
        const skippedPods: string[] = [];

        for (const pod of pods) {
          const podName = pod.metadata?.name || "unknown";
          const podNamespace = pod.metadata?.namespace || "default";

          // Skip DaemonSet pods if requested
          const ownerRefs = pod.metadata?.ownerReferences || [];
          const isDaemonSet = ownerRefs.some((ref) => ref.kind === "DaemonSet");
          if (isDaemonSet && ignoreDaemonsets) {
            skippedPods.push(`${podNamespace}/${podName} (DaemonSet)`);
            continue;
          }

          // Check for emptyDir volumes
          const volumes = pod.spec?.volumes || [];
          const hasEmptyDir = volumes.some((v) => v.emptyDir);
          if (hasEmptyDir && !deleteEmptyDir) {
            skippedPods.push(`${podNamespace}/${podName} (has emptyDir)`);
            continue;
          }

          // Evict the pod
          try {
            const eviction = {
              apiVersion: "policy/v1",
              kind: "Eviction",
              metadata: {
                name: podName,
                namespace: podNamespace,
              },
              deleteOptions: {
                gracePeriodSeconds: params.grace_period || 30,
              },
            };

            await coreApi.createNamespacedPodEviction(podName, podNamespace, eviction as any);
            evictedPods.push(`${podNamespace}/${podName}`);
          } catch (err: any) {
            if (params.force) {
              // Force delete the pod
              await coreApi.deleteNamespacedPod(podName, podNamespace);
              evictedPods.push(`${podNamespace}/${podName} (force deleted)`);
            } else {
              skippedPods.push(`${podNamespace}/${podName} (eviction failed)`);
            }
          }
        }

        let result = `Node ${params.node_name} drained\n\n`;
        result += `Evicted pods (${evictedPods.length}):\n`;
        evictedPods.forEach((pod) => {
          result += `  - ${pod}\n`;
        });

        if (skippedPods.length > 0) {
          result += `\nSkipped pods (${skippedPods.length}):\n`;
          skippedPods.forEach((pod) => {
            result += `  - ${pod}\n`;
          });
        }

        return result;
      }

      case "get_taints": {
        if (!params.node_name) {
          throw new Error("node_name is required for get_taints action");
        }

        const response = await coreApi.readNode(params.node_name);
        const taints = response.body.spec?.taints || [];

        if (taints.length === 0) {
          return `Node ${params.node_name} has no taints`;
        }

        let result = `Taints on ${params.node_name}:\n`;
        taints.forEach((t) => {
          result += `  ${t.key}=${t.value || ""}:${t.effect}\n`;
        });

        return result;
      }

      case "taint": {
        if (!params.node_name) {
          throw new Error("node_name is required for taint action");
        }
        if (!params.key) {
          throw new Error("key is required for taint action");
        }
        if (!params.effect) {
          throw new Error("effect is required for taint action");
        }

        const nodeResponse = await coreApi.readNode(params.node_name);
        const node = nodeResponse.body;

        const taints = node.spec?.taints || [];
        taints.push({
          key: params.key,
          value: params.value || "",
          effect: params.effect,
        });

        const patch = {
          spec: {
            taints,
          },
        };

        await coreApi.patchNode(
          params.node_name,
          patch,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            headers: { "Content-Type": "application/strategic-merge-patch+json" },
          }
        );

        return `Taint added to ${params.node_name}: ${params.key}=${params.value || ""}:${params.effect}`;
      }

      case "remove_taint": {
        if (!params.node_name) {
          throw new Error("node_name is required for remove_taint action");
        }
        if (!params.key) {
          throw new Error("key is required for remove_taint action");
        }

        const nodeResponse = await coreApi.readNode(params.node_name);
        const node = nodeResponse.body;

        const taints = (node.spec?.taints || []).filter((t) => t.key !== params.key);

        const patch = {
          spec: {
            taints,
          },
        };

        await coreApi.patchNode(
          params.node_name,
          patch,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            headers: { "Content-Type": "application/strategic-merge-patch+json" },
          }
        );

        return `Taint removed from ${params.node_name}: ${params.key}`;
      }

      case "label": {
        if (!params.node_name) {
          throw new Error("node_name is required for label action");
        }
        if (!params.labels) {
          throw new Error("labels is required for label action");
        }

        const nodeResponse = await coreApi.readNode(params.node_name);
        const node = nodeResponse.body;

        const currentLabels = node.metadata?.labels || {};
        const newLabels = { ...currentLabels, ...params.labels };

        const patch = {
          metadata: {
            labels: newLabels,
          },
        };

        await coreApi.patchNode(
          params.node_name,
          patch,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            headers: { "Content-Type": "application/strategic-merge-patch+json" },
          }
        );

        return `Labels added to ${params.node_name}: ${JSON.stringify(params.labels)}`;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `node ${params.action}`));
  }
}

export function registerK8sNodeTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_node",
    description:
      "Kubernetes Node operations: list, describe, status, cordon, uncordon, drain, taints, labels",
    schema: K8sNodeSchema,
    handler: async (params: K8sNodeParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sNode(params, pluginConfig);
    },
  });
}
