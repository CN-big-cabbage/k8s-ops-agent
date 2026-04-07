import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { formatAge, formatTable } from "../lib/format.js";
import { wrapK8sError } from "../lib/errors.js";
import type { PluginConfig } from "../lib/types.js";

export const K8sStatefulSetSchema = z.object({
  action: z.enum([
    "list",
    "describe",
    "status",
    "scale",
    "rollout_restart",
    "rollout_undo",
    "update_image",
  ]),
  namespace: z.string().optional(),
  statefulset_name: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  replicas: z.number().int().min(0).optional(),
  to_revision: z.number().int().positive().optional(),
  container: z.string().optional(),
  image: z.string().optional(),
  context: z.string().optional(),
});

export type K8sStatefulSetParams = z.infer<typeof K8sStatefulSetSchema>;

function formatStatefulSetList(statefulSets: k8s.V1StatefulSet[]): string {
  if (statefulSets.length === 0) {
    return "No statefulsets found.";
  }

  const headers = ["NAMESPACE", "NAME", "READY", "AGE"];
  const rows = statefulSets.map((sts) => {
    const namespace = sts.metadata?.namespace || "unknown";
    const name = sts.metadata?.name || "unknown";
    const desired = sts.spec?.replicas || 0;
    const ready = sts.status?.readyReplicas || 0;
    const readyStr = `${ready}/${desired}`;
    const creationTime = sts.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";
    return [namespace, name, readyStr, age];
  });

  return formatTable(headers, rows);
}

function formatStatefulSetDescribe(
  sts: k8s.V1StatefulSet,
  pvcs?: k8s.V1PersistentVolumeClaim[],
  events?: k8s.CoreV1Event[]
): string {
  const name = sts.metadata?.name || "unknown";
  const namespace = sts.metadata?.namespace || "unknown";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `CreationTimestamp: ${sts.metadata?.creationTimestamp || "unknown"}\n`;

  result += `\n--- Labels ---\n`;
  const labels = sts.metadata?.labels || {};
  Object.entries(labels).forEach(([k, v]) => {
    result += `  ${k}: ${v}\n`;
  });

  result += `\n--- Replicas ---\n`;
  result += `  Desired: ${sts.spec?.replicas || 0}\n`;
  result += `  Current: ${sts.status?.currentReplicas || 0}\n`;
  result += `  Ready: ${sts.status?.readyReplicas || 0}\n`;
  result += `  Updated: ${sts.status?.updatedReplicas || 0}\n`;

  result += `\n--- Selector ---\n`;
  const matchLabels = sts.spec?.selector?.matchLabels || {};
  Object.entries(matchLabels).forEach(([k, v]) => {
    result += `  ${k}: ${v}\n`;
  });

  result += `\n--- Template ---\n`;
  const containers = sts.spec?.template?.spec?.containers || [];
  containers.forEach((container) => {
    result += `  Container: ${container.name}\n`;
    result += `    Image: ${container.image}\n`;
    result += `    Ports: ${container.ports?.map((p) => p.containerPort).join(", ") || "none"}\n`;
  });

  const vcts = sts.spec?.volumeClaimTemplates || [];
  if (vcts.length > 0) {
    result += `\n--- VolumeClaimTemplates ---\n`;
    vcts.forEach((vct) => {
      result += `  ${vct.metadata?.name}: ${vct.spec?.resources?.requests?.storage || "unknown"}\n`;
    });
  }

  if (pvcs && pvcs.length > 0) {
    result += `\n--- PersistentVolumeClaims ---\n`;
    pvcs.forEach((pvc) => {
      result += `  ${pvc.metadata?.name}: ${pvc.status?.phase || "unknown"}\n`;
    });
  }

  if (events && events.length > 0) {
    result += `\n--- Recent Events ---\n`;
    events.slice(0, 10).forEach((event) => {
      const time = event.lastTimestamp || event.firstTimestamp || "";
      result += `  [${time}] ${event.type}: ${event.reason} - ${event.message}\n`;
    });
  }

  return result;
}

function formatStatefulSetStatus(sts: k8s.V1StatefulSet): string {
  const name = sts.metadata?.name || "unknown";
  const namespace = sts.metadata?.namespace || "unknown";
  const desired = sts.spec?.replicas || 0;
  const ready = sts.status?.readyReplicas || 0;
  const current = sts.status?.currentReplicas || 0;
  const updated = sts.status?.updatedReplicas || 0;

  let result = `StatefulSet: ${namespace}/${name}\n`;
  result += `Replicas: ${ready}/${desired} ready`;
  result += ` (current: ${current}, updated: ${updated})\n`;

  if (ready === desired) {
    result += `\n✓ All replicas ready`;
  } else {
    result += `\n⟳ ${desired - ready} replica(s) not ready`;
  }

  return result;
}

export async function handleK8sStatefulSet(
  params: K8sStatefulSetParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const { appsApi, coreApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let statefulSets: k8s.V1StatefulSet[];

        if (params.all_namespaces) {
          const response = await appsApi.listStatefulSetForAllNamespaces(
            undefined, undefined, undefined, params.label_selector
          );
          statefulSets = response.body.items;
        } else {
          const response = await appsApi.listNamespacedStatefulSet(
            namespace, undefined, undefined, undefined, undefined, params.label_selector
          );
          statefulSets = response.body.items;
        }

        return formatStatefulSetList(statefulSets);
      }

      case "describe": {
        if (!params.statefulset_name) {
          throw new Error("statefulset_name is required for describe action");
        }

        const stsResponse = await appsApi.readNamespacedStatefulSet(
          params.statefulset_name, namespace
        );

        let pvcs: k8s.V1PersistentVolumeClaim[] = [];
        try {
          const pvcResponse = await coreApi.listNamespacedPersistentVolumeClaim(
            namespace, undefined, undefined, undefined, undefined,
            `app=${params.statefulset_name}`
          );
          pvcs = pvcResponse.body.items;
        } catch {
          // Continue without PVCs
        }

        let events: k8s.CoreV1Event[] = [];
        try {
          const eventsResponse = await coreApi.listNamespacedEvent(
            namespace, undefined, undefined, undefined,
            `involvedObject.name=${params.statefulset_name}`
          );
          events = eventsResponse.body.items;
        } catch {
          // Continue without events
        }

        return formatStatefulSetDescribe(stsResponse.body, pvcs, events);
      }

      case "status": {
        if (!params.statefulset_name) {
          throw new Error("statefulset_name is required for status action");
        }

        const response = await appsApi.readNamespacedStatefulSet(
          params.statefulset_name, namespace
        );

        return formatStatefulSetStatus(response.body);
      }

      case "scale": {
        if (!params.statefulset_name) {
          throw new Error("statefulset_name is required for scale action");
        }
        if (params.replicas === undefined) {
          throw new Error("replicas is required for scale action");
        }

        const stsResponse = await appsApi.readNamespacedStatefulSet(
          params.statefulset_name, namespace
        );

        const sts = stsResponse.body;
        sts.spec!.replicas = params.replicas;

        await appsApi.replaceNamespacedStatefulSet(
          params.statefulset_name, namespace, sts
        );

        return `StatefulSet ${namespace}/${params.statefulset_name} scaled to ${params.replicas} replicas`;
      }

      case "rollout_restart": {
        if (!params.statefulset_name) {
          throw new Error("statefulset_name is required for rollout_restart action");
        }

        const stsResponse = await appsApi.readNamespacedStatefulSet(
          params.statefulset_name, namespace
        );

        const sts = stsResponse.body;

        if (!sts.spec!.template!.metadata) {
          sts.spec!.template!.metadata = {};
        }
        if (!sts.spec!.template!.metadata!.annotations) {
          sts.spec!.template!.metadata!.annotations = {};
        }

        sts.spec!.template!.metadata!.annotations["kubectl.kubernetes.io/restartedAt"] =
          new Date().toISOString();

        await appsApi.replaceNamespacedStatefulSet(
          params.statefulset_name, namespace, sts
        );

        return `StatefulSet ${namespace}/${params.statefulset_name} restarted. Rollout initiated.`;
      }

      case "rollout_undo": {
        if (!params.statefulset_name) {
          throw new Error("statefulset_name is required for rollout_undo action");
        }

        const stsResponse = await appsApi.readNamespacedStatefulSet(
          params.statefulset_name, namespace
        );

        const matchLabels = stsResponse.body.spec?.selector?.matchLabels || {};
        const labelSelector = Object.entries(matchLabels)
          .map(([k, v]) => `${k}=${v}`)
          .join(",");

        const crResponse = await appsApi.listNamespacedControllerRevision(
          namespace, undefined, undefined, undefined, undefined, labelSelector
        );

        const revisions = crResponse.body.items.sort(
          (a, b) => (a.revision || 0) - (b.revision || 0)
        );

        if (revisions.length < 2) {
          throw new Error("No previous revision found");
        }

        let targetRevision;
        if (params.to_revision !== undefined) {
          targetRevision = revisions.find((r) => r.revision === params.to_revision);
          if (!targetRevision) {
            throw new Error(`Revision ${params.to_revision} not found`);
          }
        } else {
          targetRevision = revisions[revisions.length - 2];
        }

        const sts = stsResponse.body;
        const revisionData = targetRevision.data as any;
        if (revisionData?.spec?.template) {
          sts.spec!.template = revisionData.spec.template;
        }

        await appsApi.replaceNamespacedStatefulSet(
          params.statefulset_name, namespace, sts
        );

        return `StatefulSet ${namespace}/${params.statefulset_name} rolled back to revision ${targetRevision.revision}`;
      }

      case "update_image": {
        if (!params.statefulset_name) {
          throw new Error("statefulset_name is required for update_image action");
        }
        if (!params.container) {
          throw new Error("container is required for update_image action");
        }
        if (!params.image) {
          throw new Error("image is required for update_image action");
        }

        const stsResponse = await appsApi.readNamespacedStatefulSet(
          params.statefulset_name, namespace
        );

        const sts = stsResponse.body;
        const containers = sts.spec!.template!.spec!.containers;
        const container = containers.find((c) => c.name === params.container);

        if (!container) {
          throw new Error(`Container ${params.container} not found in statefulset`);
        }

        container.image = params.image;

        await appsApi.replaceNamespacedStatefulSet(
          params.statefulset_name, namespace, sts
        );

        return `StatefulSet ${namespace}/${params.statefulset_name} updated: ${params.container} image set to ${params.image}`;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `statefulset ${params.action}`));
  }
}

