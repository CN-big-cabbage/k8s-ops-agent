import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { formatAge, formatTable } from "../lib/format.js";
import { wrapK8sError } from "../lib/errors.js";
import type { PluginConfig } from "../lib/types.js";

// Zod schema for k8s_pod tool parameters
export const K8sPodSchema = z.object({
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

export type K8sPodParams = z.infer<typeof K8sPodSchema>;

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
      stateStr = `Running (started ${formatAge(new Date(state.running.startedAt!))})`;
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

export async function handleK8sPod(params: K8sPodParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi } = createK8sClients(pluginConfig, params.context);

    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let pods: k8s.V1Pod[];

        if (params.all_namespaces) {
          const response = await coreApi.listPodForAllNamespaces(
            undefined,
            undefined,
            undefined,
            params.label_selector
          );
          pods = response.body.items;
        } else {
          const response = await coreApi.listNamespacedPod(
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

        const response = await coreApi.readNamespacedPod(params.pod_name, namespace);
        return formatPodStatus(response.body);
      }

      case "describe": {
        if (!params.pod_name) {
          throw new Error("pod_name is required for describe action");
        }

        const podResponse = await coreApi.readNamespacedPod(params.pod_name, namespace);

        // Fetch events
        let events: k8s.CoreV1Event[] = [];
        try {
          const eventsResponse = await coreApi.listNamespacedEvent(
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

        const logResponse = await coreApi.readNamespacedPodLog(
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

        const podInfo = await coreApi.readNamespacedPod(params.pod_name, namespace);
        const ownerRefs = podInfo.body.metadata?.ownerReferences || [];
        const hasController = ownerRefs.some(ref => ref.controller === true);

        if (!hasController) {
          throw new Error(
            `Pod ${namespace}/${params.pod_name} has no controller (ownerReferences). ` +
            `Deleting it will permanently remove this pod. ` +
            `This pod is standalone and will NOT be recreated automatically.`
          );
        }

        await coreApi.deleteNamespacedPod(params.pod_name, namespace);
        const controllerKind = ownerRefs.find(ref => ref.controller)?.kind || "controller";
        return `Pod ${namespace}/${params.pod_name} deleted. It will be recreated by its ${controllerKind}.`;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `pod ${params.action}`));
  }
}

