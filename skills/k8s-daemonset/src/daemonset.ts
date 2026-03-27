import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatAge, formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";

export const K8sDaemonSetSchema = z.object({
  action: z.enum([
    "list",
    "describe",
    "status",
    "rollout_restart",
    "update_image",
  ]),
  namespace: z.string().optional(),
  daemonset_name: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  container: z.string().optional(),
  image: z.string().optional(),
  context: z.string().optional(),
});

type K8sDaemonSetParams = z.infer<typeof K8sDaemonSetSchema>;

function formatDaemonSetList(daemonSets: k8s.V1DaemonSet[]): string {
  if (daemonSets.length === 0) {
    return "No daemonsets found.";
  }

  const headers = ["NAMESPACE", "NAME", "DESIRED", "CURRENT", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"];
  const rows = daemonSets.map((ds) => {
    const namespace = ds.metadata?.namespace || "unknown";
    const name = ds.metadata?.name || "unknown";
    const desired = ds.status?.desiredNumberScheduled || 0;
    const current = ds.status?.currentNumberScheduled || 0;
    const ready = ds.status?.numberReady || 0;
    const upToDate = ds.status?.updatedNumberScheduled || 0;
    const available = ds.status?.numberAvailable || 0;
    const creationTime = ds.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";
    return [
      namespace, name, desired.toString(), current.toString(),
      ready.toString(), upToDate.toString(), available.toString(), age,
    ];
  });

  return formatTable(headers, rows);
}

function formatDaemonSetDescribe(
  ds: k8s.V1DaemonSet,
  events?: k8s.CoreV1Event[]
): string {
  const name = ds.metadata?.name || "unknown";
  const namespace = ds.metadata?.namespace || "unknown";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `CreationTimestamp: ${ds.metadata?.creationTimestamp || "unknown"}\n`;

  result += `\n--- Labels ---\n`;
  const labels = ds.metadata?.labels || {};
  Object.entries(labels).forEach(([k, v]) => {
    result += `  ${k}: ${v}\n`;
  });

  result += `\n--- Node Coverage ---\n`;
  result += `  Desired: ${ds.status?.desiredNumberScheduled || 0}\n`;
  result += `  Current: ${ds.status?.currentNumberScheduled || 0}\n`;
  result += `  Ready: ${ds.status?.numberReady || 0}\n`;
  result += `  Up-to-date: ${ds.status?.updatedNumberScheduled || 0}\n`;
  result += `  Available: ${ds.status?.numberAvailable || 0}\n`;
  result += `  Misscheduled: ${ds.status?.numberMisscheduled || 0}\n`;

  result += `\n--- Selector ---\n`;
  const matchLabels = ds.spec?.selector?.matchLabels || {};
  Object.entries(matchLabels).forEach(([k, v]) => {
    result += `  ${k}: ${v}\n`;
  });

  const nodeSelector = ds.spec?.template?.spec?.nodeSelector;
  if (nodeSelector) {
    result += `\n--- Node Selector ---\n`;
    Object.entries(nodeSelector).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  const tolerations = ds.spec?.template?.spec?.tolerations;
  if (tolerations && tolerations.length > 0) {
    result += `\n--- Tolerations ---\n`;
    tolerations.forEach((t) => {
      result += `  ${t.key || "*"}:${t.operator || "Equal"}=${t.value || ""} (${t.effect || "all"})\n`;
    });
  }

  result += `\n--- Template ---\n`;
  const containers = ds.spec?.template?.spec?.containers || [];
  containers.forEach((container) => {
    result += `  Container: ${container.name}\n`;
    result += `    Image: ${container.image}\n`;
    result += `    Ports: ${container.ports?.map((p) => p.containerPort).join(", ") || "none"}\n`;
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

function formatDaemonSetStatus(ds: k8s.V1DaemonSet): string {
  const name = ds.metadata?.name || "unknown";
  const namespace = ds.metadata?.namespace || "unknown";
  const desired = ds.status?.desiredNumberScheduled || 0;
  const ready = ds.status?.numberReady || 0;
  const upToDate = ds.status?.updatedNumberScheduled || 0;
  const misscheduled = ds.status?.numberMisscheduled || 0;

  let result = `DaemonSet: ${namespace}/${name}\n`;
  result += `Node Coverage: ${ready}/${desired} ready`;
  result += ` (up-to-date: ${upToDate})\n`;

  if (misscheduled > 0) {
    result += `⚠ ${misscheduled} node(s) misscheduled\n`;
  }

  if (ready === desired) {
    result += `\n✓ All nodes covered`;
  } else {
    result += `\n⟳ ${desired - ready} node(s) not ready`;
  }

  return result;
}

export async function handleK8sDaemonSet(
  params: K8sDaemonSetParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const { appsApi, coreApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let daemonSets: k8s.V1DaemonSet[];

        if (params.all_namespaces) {
          const response = await appsApi.listDaemonSetForAllNamespaces(
            undefined, undefined, undefined, params.label_selector
          );
          daemonSets = response.body.items;
        } else {
          const response = await appsApi.listNamespacedDaemonSet(
            namespace, undefined, undefined, undefined, undefined, params.label_selector
          );
          daemonSets = response.body.items;
        }

        return formatDaemonSetList(daemonSets);
      }

      case "describe": {
        if (!params.daemonset_name) {
          throw new Error("daemonset_name is required for describe action");
        }

        const dsResponse = await appsApi.readNamespacedDaemonSet(
          params.daemonset_name, namespace
        );

        let events: k8s.CoreV1Event[] = [];
        try {
          const eventsResponse = await coreApi.listNamespacedEvent(
            namespace, undefined, undefined, undefined,
            `involvedObject.name=${params.daemonset_name}`
          );
          events = eventsResponse.body.items;
        } catch {
          // Continue without events
        }

        return formatDaemonSetDescribe(dsResponse.body, events);
      }

      case "status": {
        if (!params.daemonset_name) {
          throw new Error("daemonset_name is required for status action");
        }

        const response = await appsApi.readNamespacedDaemonSet(
          params.daemonset_name, namespace
        );

        return formatDaemonSetStatus(response.body);
      }

      case "rollout_restart": {
        if (!params.daemonset_name) {
          throw new Error("daemonset_name is required for rollout_restart action");
        }

        const dsResponse = await appsApi.readNamespacedDaemonSet(
          params.daemonset_name, namespace
        );

        const ds = dsResponse.body;

        if (!ds.spec!.template!.metadata) {
          ds.spec!.template!.metadata = {};
        }
        if (!ds.spec!.template!.metadata!.annotations) {
          ds.spec!.template!.metadata!.annotations = {};
        }

        ds.spec!.template!.metadata!.annotations["kubectl.kubernetes.io/restartedAt"] =
          new Date().toISOString();

        await appsApi.replaceNamespacedDaemonSet(
          params.daemonset_name, namespace, ds
        );

        return `DaemonSet ${namespace}/${params.daemonset_name} restarted. Rollout initiated.`;
      }

      case "update_image": {
        if (!params.daemonset_name) {
          throw new Error("daemonset_name is required for update_image action");
        }
        if (!params.container) {
          throw new Error("container is required for update_image action");
        }
        if (!params.image) {
          throw new Error("image is required for update_image action");
        }

        const dsResponse = await appsApi.readNamespacedDaemonSet(
          params.daemonset_name, namespace
        );

        const ds = dsResponse.body;
        const containers = ds.spec!.template!.spec!.containers;
        const container = containers.find((c) => c.name === params.container);

        if (!container) {
          throw new Error(`Container ${params.container} not found in daemonset`);
        }

        container.image = params.image;

        await appsApi.replaceNamespacedDaemonSet(
          params.daemonset_name, namespace, ds
        );

        return `DaemonSet ${namespace}/${params.daemonset_name} updated: ${params.container} image set to ${params.image}`;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `daemonset ${params.action}`));
  }
}

export function registerK8sDaemonSetTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_daemonset",
    description:
      "Kubernetes DaemonSet operations: list, describe, status, rollout-restart, update-image",
    schema: K8sDaemonSetSchema,
    handler: async (params: K8sDaemonSetParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sDaemonSet(params, pluginConfig);
    },
  });
}
