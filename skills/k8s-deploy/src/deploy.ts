import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";

// Zod schema for k8s_deploy tool parameters
const K8sDeploySchema = z.object({
  action: z.enum([
    "list",
    "describe",
    "scale",
    "rollout_status",
    "rollout_history",
    "rollout_restart",
    "rollout_undo",
    "update_image",
  ]),
  namespace: z.string().optional(),
  deployment_name: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  replicas: z.number().int().min(0).optional(),
  revision: z.number().int().positive().optional(),
  to_revision: z.number().int().positive().optional(),
  container: z.string().optional(),
  image: z.string().optional(),
  context: z.string().optional(),
});

type K8sDeployParams = z.infer<typeof K8sDeploySchema>;

let kc: k8s.KubeConfig;
let appsApi: k8s.AppsV1Api;
let coreApi: k8s.CoreV1Api;

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

    appsApi = kc.makeApiClient(k8s.AppsV1Api);
    coreApi = kc.makeApiClient(k8s.CoreV1Api);
  }

  return { kc, appsApi, coreApi };
}

function formatDeploymentList(deployments: k8s.V1Deployment[]): string {
  if (deployments.length === 0) {
    return "No deployments found.";
  }

  const headers = ["NAMESPACE", "NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"];
  const rows = deployments.map((deploy) => {
    const namespace = deploy.metadata?.namespace || "unknown";
    const name = deploy.metadata?.name || "unknown";

    const desired = deploy.spec?.replicas || 0;
    const ready = deploy.status?.readyReplicas || 0;
    const readyStr = `${ready}/${desired}`;

    const upToDate = deploy.status?.updatedReplicas || 0;
    const available = deploy.status?.availableReplicas || 0;

    const creationTime = deploy.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";

    return [namespace, name, readyStr, upToDate.toString(), available.toString(), age];
  });

  return formatTable(headers, rows);
}

function formatDeploymentDescribe(
  deployment: k8s.V1Deployment,
  replicaSets?: k8s.V1ReplicaSet[],
  events?: k8s.CoreV1Event[]
): string {
  const name = deployment.metadata?.name || "unknown";
  const namespace = deployment.metadata?.namespace || "unknown";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `CreationTimestamp: ${deployment.metadata?.creationTimestamp || "unknown"}\n`;

  result += `\n--- Labels ---\n`;
  const labels = deployment.metadata?.labels || {};
  Object.entries(labels).forEach(([k, v]) => {
    result += `  ${k}: ${v}\n`;
  });

  result += `\n--- Annotations ---\n`;
  const annotations = deployment.metadata?.annotations || {};
  const changeCause = annotations["kubernetes.io/change-cause"];
  if (changeCause) {
    result += `  Change-Cause: ${changeCause}\n`;
  }

  result += `\n--- Replicas ---\n`;
  result += `  Desired: ${deployment.spec?.replicas || 0}\n`;
  result += `  Updated: ${deployment.status?.updatedReplicas || 0}\n`;
  result += `  Ready: ${deployment.status?.readyReplicas || 0}\n`;
  result += `  Available: ${deployment.status?.availableReplicas || 0}\n`;
  result += `  Unavailable: ${deployment.status?.unavailableReplicas || 0}\n`;

  result += `\n--- Strategy ---\n`;
  const strategy = deployment.spec?.strategy;
  result += `  Type: ${strategy?.type || "RollingUpdate"}\n`;
  if (strategy?.type === "RollingUpdate" && strategy.rollingUpdate) {
    result += `  MaxUnavailable: ${strategy.rollingUpdate.maxUnavailable || "default"}\n`;
    result += `  MaxSurge: ${strategy.rollingUpdate.maxSurge || "default"}\n`;
  }

  result += `\n--- Selector ---\n`;
  const matchLabels = deployment.spec?.selector?.matchLabels || {};
  Object.entries(matchLabels).forEach(([k, v]) => {
    result += `  ${k}: ${v}\n`;
  });

  result += `\n--- Template ---\n`;
  const containers = deployment.spec?.template?.spec?.containers || [];
  containers.forEach((container) => {
    result += `  Container: ${container.name}\n`;
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
  const conditions = deployment.status?.conditions || [];
  conditions.forEach((c) => {
    result += `  ${c.type}: ${c.status} (${c.reason || ""})\n`;
    if (c.message) {
      result += `    Message: ${c.message}\n`;
    }
  });

  if (replicaSets && replicaSets.length > 0) {
    result += `\n--- ReplicaSets ---\n`;
    replicaSets.slice(0, 5).forEach((rs) => {
      const desired = rs.spec?.replicas || 0;
      const current = rs.status?.replicas || 0;
      const ready = rs.status?.readyReplicas || 0;
      result += `  ${rs.metadata?.name}: ${ready}/${desired} (current: ${current})\n`;
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

function formatRolloutStatus(deployment: k8s.V1Deployment): string {
  const name = deployment.metadata?.name || "unknown";
  const namespace = deployment.metadata?.namespace || "unknown";

  const desired = deployment.spec?.replicas || 0;
  const updated = deployment.status?.updatedReplicas || 0;
  const ready = deployment.status?.readyReplicas || 0;
  const available = deployment.status?.availableReplicas || 0;

  let result = `Deployment: ${namespace}/${name}\n`;
  result += `Replicas: ${ready}/${desired} (updated: ${updated}, available: ${available})\n`;

  const conditions = deployment.status?.conditions || [];
  const progressCondition = conditions.find((c) => c.type === "Progressing");
  const availableCondition = conditions.find((c) => c.type === "Available");

  if (progressCondition) {
    result += `\nProgressing: ${progressCondition.status}\n`;
    result += `  Reason: ${progressCondition.reason || "unknown"}\n`;
    result += `  Message: ${progressCondition.message || "none"}\n`;
  }

  if (availableCondition) {
    result += `\nAvailable: ${availableCondition.status}\n`;
    result += `  Reason: ${availableCondition.reason || "unknown"}\n`;
  }

  // Determine overall status
  if (updated === desired && ready === desired && available === desired) {
    result += `\n✓ Rollout completed successfully`;
  } else if (progressCondition?.reason === "ProgressDeadlineExceeded") {
    result += `\n✗ Rollout failed: Progress deadline exceeded`;
  } else {
    result += `\n⟳ Rollout in progress...`;
  }

  return result;
}

function formatRolloutHistory(
  deployment: k8s.V1Deployment,
  replicaSets: k8s.V1ReplicaSet[],
  specificRevision?: number
): string {
  const name = deployment.metadata?.name || "unknown";
  const namespace = deployment.metadata?.namespace || "unknown";

  // Sort ReplicaSets by revision
  const sortedRS = replicaSets
    .filter((rs) => rs.metadata?.annotations?.["deployment.kubernetes.io/revision"])
    .sort((a, b) => {
      const revA = parseInt(
        a.metadata?.annotations?.["deployment.kubernetes.io/revision"] || "0"
      );
      const revB = parseInt(
        b.metadata?.annotations?.["deployment.kubernetes.io/revision"] || "0"
      );
      return revA - revB;
    });

  if (specificRevision !== undefined) {
    const rs = sortedRS.find(
      (rs) =>
        parseInt(rs.metadata?.annotations?.["deployment.kubernetes.io/revision"] || "0") ===
        specificRevision
    );

    if (!rs) {
      return `Revision ${specificRevision} not found for deployment ${namespace}/${name}`;
    }

    let result = `Deployment: ${namespace}/${name}\n`;
    result += `Revision: ${specificRevision}\n`;
    result += `Change-Cause: ${rs.metadata?.annotations?.["kubernetes.io/change-cause"] || "(none)"}\n`;
    result += `\nPod Template:\n`;

    const containers = rs.spec?.template?.spec?.containers || [];
    containers.forEach((container) => {
      result += `  Container: ${container.name}\n`;
      result += `    Image: ${container.image}\n`;
    });

    return result;
  }

  let result = `Deployment: ${namespace}/${name}\n`;
  result += `Rollout History:\n\n`;

  const headers = ["REVISION", "CHANGE-CAUSE"];
  const rows = sortedRS.map((rs) => {
    const revision =
      rs.metadata?.annotations?.["deployment.kubernetes.io/revision"] || "unknown";
    const changeCause =
      rs.metadata?.annotations?.["kubernetes.io/change-cause"] || "(none)";
    return [revision, changeCause];
  });

  result += formatTable(headers, rows);

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

async function handleK8sDeploy(params: K8sDeployParams, pluginConfig?: any): Promise<string> {
  try {
    const { appsApi, coreApi } = initializeK8sClient(
      pluginConfig?.kubeconfigPath,
      params.context || pluginConfig?.defaultContext
    );

    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let deployments: k8s.V1Deployment[];

        if (params.all_namespaces) {
          const response = await appsApi.listDeploymentForAllNamespaces(
            undefined,
            undefined,
            undefined,
            params.label_selector
          );
          deployments = response.body.items;
        } else {
          const response = await appsApi.listNamespacedDeployment(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            params.label_selector
          );
          deployments = response.body.items;
        }

        return formatDeploymentList(deployments);
      }

      case "describe": {
        if (!params.deployment_name) {
          throw new Error("deployment_name is required for describe action");
        }

        const deployResponse = await appsApi.readNamespacedDeployment(
          params.deployment_name,
          namespace
        );

        // Fetch ReplicaSets
        let replicaSets: k8s.V1ReplicaSet[] = [];
        try {
          const rsResponse = await appsApi.listNamespacedReplicaSet(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            `app=${deployResponse.body.spec?.selector?.matchLabels?.app || params.deployment_name}`
          );
          replicaSets = rsResponse.body.items;
        } catch (err) {
          // Continue without ReplicaSets
        }

        // Fetch events
        let events: k8s.CoreV1Event[] = [];
        try {
          const eventsResponse = await coreApi.listNamespacedEvent(
            namespace,
            undefined,
            undefined,
            undefined,
            `involvedObject.name=${params.deployment_name}`
          );
          events = eventsResponse.body.items;
        } catch (err) {
          // Continue without events
        }

        return formatDeploymentDescribe(deployResponse.body, replicaSets, events);
      }

      case "scale": {
        if (!params.deployment_name) {
          throw new Error("deployment_name is required for scale action");
        }
        if (params.replicas === undefined) {
          throw new Error("replicas is required for scale action");
        }

        const deployResponse = await appsApi.readNamespacedDeployment(
          params.deployment_name,
          namespace
        );

        const deployment = deployResponse.body;
        deployment.spec!.replicas = params.replicas;

        await appsApi.replaceNamespacedDeployment(
          params.deployment_name,
          namespace,
          deployment
        );

        return `Deployment ${namespace}/${params.deployment_name} scaled to ${params.replicas} replicas`;
      }

      case "rollout_status": {
        if (!params.deployment_name) {
          throw new Error("deployment_name is required for rollout_status action");
        }

        const response = await appsApi.readNamespacedDeployment(
          params.deployment_name,
          namespace
        );

        return formatRolloutStatus(response.body);
      }

      case "rollout_history": {
        if (!params.deployment_name) {
          throw new Error("deployment_name is required for rollout_history action");
        }

        const deployResponse = await appsApi.readNamespacedDeployment(
          params.deployment_name,
          namespace
        );

        const rsResponse = await appsApi.listNamespacedReplicaSet(
          namespace,
          undefined,
          undefined,
          undefined,
          undefined,
          `app=${deployResponse.body.spec?.selector?.matchLabels?.app || params.deployment_name}`
        );

        return formatRolloutHistory(
          deployResponse.body,
          rsResponse.body.items,
          params.revision
        );
      }

      case "rollout_restart": {
        if (!params.deployment_name) {
          throw new Error("deployment_name is required for rollout_restart action");
        }

        const deployResponse = await appsApi.readNamespacedDeployment(
          params.deployment_name,
          namespace
        );

        const deployment = deployResponse.body;

        // Add/update restart annotation to trigger rollout
        if (!deployment.spec!.template!.metadata) {
          deployment.spec!.template!.metadata = {};
        }
        if (!deployment.spec!.template!.metadata!.annotations) {
          deployment.spec!.template!.metadata!.annotations = {};
        }

        deployment.spec!.template!.metadata!.annotations["kubectl.kubernetes.io/restartedAt"] =
          new Date().toISOString();

        await appsApi.replaceNamespacedDeployment(
          params.deployment_name,
          namespace,
          deployment
        );

        return `Deployment ${namespace}/${params.deployment_name} restarted. Rollout initiated.`;
      }

      case "rollout_undo": {
        if (!params.deployment_name) {
          throw new Error("deployment_name is required for rollout_undo action");
        }

        const deployResponse = await appsApi.readNamespacedDeployment(
          params.deployment_name,
          namespace
        );

        const rsResponse = await appsApi.listNamespacedReplicaSet(
          namespace,
          undefined,
          undefined,
          undefined,
          undefined,
          `app=${deployResponse.body.spec?.selector?.matchLabels?.app || params.deployment_name}`
        );

        const replicaSets = rsResponse.body.items
          .filter((rs) => rs.metadata?.annotations?.["deployment.kubernetes.io/revision"])
          .sort((a, b) => {
            const revA = parseInt(
              a.metadata?.annotations?.["deployment.kubernetes.io/revision"] || "0"
            );
            const revB = parseInt(
              b.metadata?.annotations?.["deployment.kubernetes.io/revision"] || "0"
            );
            return revB - revA; // Descending order
          });

        let targetRS: k8s.V1ReplicaSet;

        if (params.to_revision !== undefined) {
          const found = replicaSets.find(
            (rs) =>
              parseInt(rs.metadata?.annotations?.["deployment.kubernetes.io/revision"] || "0") ===
              params.to_revision
          );
          if (!found) {
            throw new Error(`Revision ${params.to_revision} not found`);
          }
          targetRS = found;
        } else {
          // Rollback to previous revision (second in the list)
          if (replicaSets.length < 2) {
            throw new Error("No previous revision found");
          }
          targetRS = replicaSets[1];
        }

        // Update deployment with target ReplicaSet's template
        const deployment = deployResponse.body;
        deployment.spec!.template = targetRS.spec!.template!;

        await appsApi.replaceNamespacedDeployment(
          params.deployment_name,
          namespace,
          deployment
        );

        const targetRevision =
          params.to_revision ||
          parseInt(targetRS.metadata?.annotations?.["deployment.kubernetes.io/revision"] || "0");

        return `Deployment ${namespace}/${params.deployment_name} rolled back to revision ${targetRevision}`;
      }

      case "update_image": {
        if (!params.deployment_name) {
          throw new Error("deployment_name is required for update_image action");
        }
        if (!params.container) {
          throw new Error("container is required for update_image action");
        }
        if (!params.image) {
          throw new Error("image is required for update_image action");
        }

        const deployResponse = await appsApi.readNamespacedDeployment(
          params.deployment_name,
          namespace
        );

        const deployment = deployResponse.body;
        const containers = deployment.spec!.template!.spec!.containers;

        const container = containers.find((c) => c.name === params.container);
        if (!container) {
          throw new Error(`Container ${params.container} not found in deployment`);
        }

        container.image = params.image;

        await appsApi.replaceNamespacedDeployment(
          params.deployment_name,
          namespace,
          deployment
        );

        return `Deployment ${namespace}/${params.deployment_name} updated: ${params.container} image set to ${params.image}`;
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

export function registerK8sDeployTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_deploy",
    description:
      "Kubernetes Deployment operations: list, describe, scale, rollout (status/history/restart/undo), update-image",
    schema: K8sDeploySchema,
    handler: async (params: K8sDeployParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sDeploy(params, pluginConfig);
    },
  });
}
