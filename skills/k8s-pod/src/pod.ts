import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";

// Zod schema for k8s_pod tool parameters
const K8sPodSchema = z.object({
  action: z.enum(["list", "describe", "logs", "restart", "status"]),
  namespace: z.string().optional(),
  pod_name: z.string().optional(),
  container: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  previous: z.boolean().optional(),
  tail_lines: z.number().int().positive().optional(),
  context: z.string().optional(),
});

type K8sPodParams = z.infer<typeof K8sPodSchema>;

let kc: k8s.KubeConfig;
let k8sApi: k8s.CoreV1Api;

function initializeK8sClient(customKubeconfigPath?: string, customContext?: string) {
  if (!kc) {
    kc = new k8s.KubeConfig();

    if (customKubeconfigPath) {
      kc.loadFromFile(customKubeconfigPath);
    } else {
      kc.loadFromDefault();
    }

    if (customContext) {
      kc.setCurrentContext(customContext);
    }

    k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  }

  return { kc, k8sApi };
}

function formatPodList(pods: k8s.V1Pod[]): string {
  if (pods.length === 0) {
    return "No pods found.";
  }

  const headers = ["NAMESPACE", "NAME", "READY", "STATUS", "RESTARTS", "AGE", "NODE"];
  const rows = pods.map((pod) => {
    const namespace = pod.metadata?.namespace || "unknown";
    const name = pod.metadata?.name || "unknown";

    const containerStatuses = pod.status?.containerStatuses || [];
    const readyCount = containerStatuses.filter((c) => c.ready).length;
    const totalCount = containerStatuses.length;
    const ready = `${readyCount}/${totalCount}`;

    const phase = pod.status?.phase || "Unknown";

    const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);

    const creationTime = pod.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";

    const nodeName = pod.spec?.nodeName || "none";

    return [namespace, name, ready, phase, restarts.toString(), age, nodeName];
  });

  return formatTable(headers, rows);
}

function formatPodStatus(pod: k8s.V1Pod): string {
  const name = pod.metadata?.name || "unknown";
  const namespace = pod.metadata?.namespace || "unknown";
  const phase = pod.status?.phase || "Unknown";

  const containerStatuses = pod.status?.containerStatuses || [];
  const readyCount = containerStatuses.filter((c) => c.ready).length;
  const totalCount = containerStatuses.length;

  const restarts = containerStatuses.reduce((sum, c) => sum + (c.restartCount || 0), 0);

  const conditions = pod.status?.conditions || [];
  const conditionsStr = conditions
    .map((c) => `${c.type}=${c.status}`)
    .join(", ");

  let result = `Pod: ${namespace}/${name}\n`;
  result += `Status: ${phase}\n`;
  result += `Ready: ${readyCount}/${totalCount}\n`;
  result += `Restarts: ${restarts}\n`;
  result += `Conditions: ${conditionsStr}\n`;

  // Container states
  result += `\nContainers:\n`;
  containerStatuses.forEach((cs) => {
    const state = cs.state;
    let stateStr = "unknown";
    if (state?.running) {
      stateStr = `Running (started ${formatAge(new Date(state.running.startedAt))})`;
    } else if (state?.waiting) {
      stateStr = `Waiting (${state.waiting.reason || "unknown reason"})`;
    } else if (state?.terminated) {
      stateStr = `Terminated (${state.terminated.reason || "unknown reason"}, exit code: ${state.terminated.exitCode})`;
    }

    result += `  - ${cs.name}: ${stateStr}, restarts: ${cs.restartCount}\n`;
  });

  return result;
}

function formatPodDescribe(pod: k8s.V1Pod, events?: k8s.CoreV1Event[]): string {
  const name = pod.metadata?.name || "unknown";
  const namespace = pod.metadata?.namespace || "unknown";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `Node: ${pod.spec?.nodeName || "none"}\n`;
  result += `Status: ${pod.status?.phase || "Unknown"}\n`;
  result += `IP: ${pod.status?.podIP || "none"}\n`;
  result += `\n--- Labels ---\n`;
  const labels = pod.metadata?.labels || {};
  Object.entries(labels).forEach(([k, v]) => {
    result += `  ${k}: ${v}\n`;
  });

  result += `\n--- Containers ---\n`;
  const containers = pod.spec?.containers || [];
  containers.forEach((container) => {
    result += `  Name: ${container.name}\n`;
    result += `    Image: ${container.image}\n`;
    result += `    Ports: ${container.ports?.map((p) => p.containerPort).join(", ") || "none"}\n`;

    if (container.resources?.requests) {
      result += `    Requests: CPU=${container.resources.requests.cpu || "none"}, Memory=${container.resources.requests.memory || "none"}\n`;
    }
    if (container.resources?.limits) {
      result += `    Limits: CPU=${container.resources.limits.cpu || "none"}, Memory=${container.resources.limits.memory || "none"}\n`;
    }
  });

  result += `\n--- Conditions ---\n`;
  const conditions = pod.status?.conditions || [];
  conditions.forEach((c) => {
    result += `  ${c.type}: ${c.status} (${c.reason || ""})\n`;
  });

  if (events && events.length > 0) {
    result += `\n--- Recent Events ---\n`;
    events.slice(0, 10).forEach((event) => {
      const time = event.lastTimestamp || event.firstTimestamp || "";
      result += `  [${time}] ${event.type}: ${event.reason} - ${event.message}\n`;
    });
  }

  return result;
}

function formatAge(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 0) return `${diffDay}d`;
  if (diffHour > 0) return `${diffHour}h`;
  if (diffMin > 0) return `${diffMin}m`;
  return `${diffSec}s`;
}

function formatTable(headers: string[], rows: string[][]): string {
  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    const maxRowWidth = Math.max(...rows.map((r) => (r[i] || "").length));
    return Math.max(h.length, maxRowWidth);
  });

  // Format header
  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join("  ");
  const separator = colWidths.map((w) => "-".repeat(w)).join("  ");

  // Format rows
  const dataRows = rows.map((row) =>
    row.map((cell, i) => (cell || "").padEnd(colWidths[i])).join("  ")
  );

  return [headerRow, separator, ...dataRows].join("\n");
}

async function handleK8sPod(params: K8sPodParams, pluginConfig?: any): Promise<string> {
  try {
    const { k8sApi } = initializeK8sClient(
      pluginConfig?.kubeconfigPath,
      params.context || pluginConfig?.defaultContext
    );

    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let pods: k8s.V1Pod[];

        if (params.all_namespaces) {
          const response = await k8sApi.listPodForAllNamespaces(
            undefined,
            undefined,
            undefined,
            params.label_selector
          );
          pods = response.body.items;
        } else {
          const response = await k8sApi.listNamespacedPod(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            params.label_selector
          );
          pods = response.body.items;
        }

        return formatPodList(pods);
      }

      case "status": {
        if (!params.pod_name) {
          throw new Error("pod_name is required for status action");
        }

        const response = await k8sApi.readNamespacedPod(params.pod_name, namespace);
        return formatPodStatus(response.body);
      }

      case "describe": {
        if (!params.pod_name) {
          throw new Error("pod_name is required for describe action");
        }

        const podResponse = await k8sApi.readNamespacedPod(params.pod_name, namespace);

        // Fetch events
        let events: k8s.CoreV1Event[] = [];
        try {
          const eventsResponse = await k8sApi.listNamespacedEvent(
            namespace,
            undefined,
            undefined,
            undefined,
            `involvedObject.name=${params.pod_name}`
          );
          events = eventsResponse.body.items;
        } catch (err) {
          // Events might not be accessible, continue without them
        }

        return formatPodDescribe(podResponse.body, events);
      }

      case "logs": {
        if (!params.pod_name) {
          throw new Error("pod_name is required for logs action");
        }

        const logResponse = await k8sApi.readNamespacedPodLog(
          params.pod_name,
          namespace,
          params.container,
          undefined,
          undefined,
          undefined,
          undefined,
          params.previous,
          undefined,
          params.tail_lines,
          undefined
        );

        return logResponse.body || "(empty logs)";
      }

      case "restart": {
        if (!params.pod_name) {
          throw new Error("pod_name is required for restart action");
        }

        await k8sApi.deleteNamespacedPod(params.pod_name, namespace);
        return `Pod ${namespace}/${params.pod_name} deleted successfully. It will be recreated by its controller.`;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: any) {
    if (error.response?.body?.message) {
      throw new Error(`Kubernetes API error: ${error.response.body.message}`);
    }
    throw error;
  }
}

export function registerK8sPodTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_pod",
    description: "Kubernetes Pod operations: list, describe, logs, restart, status",
    schema: K8sPodSchema,
    handler: async (params: K8sPodParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sPod(params, pluginConfig);
    },
  });
}
