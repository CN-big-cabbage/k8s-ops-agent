import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatAge, formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// Zod schema for k8s_namespace tool parameters
const K8sNamespaceSchema = z.object({
  action: z.enum(["list", "describe", "quota", "limits", "summary", "create", "label", "delete", "set_quota"]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  labels: z.record(z.string()).optional(),
  hard: z.record(z.string()).optional(),
  context: z.string().optional(),
});

type K8sNamespaceParams = z.infer<typeof K8sNamespaceSchema>;

function formatNamespaceList(namespaces: k8s.V1Namespace[]): string {
  if (namespaces.length === 0) {
    return "No namespaces found.";
  }

  const headers = ["NAME", "STATUS", "AGE"];
  const rows = namespaces.map((ns) => {
    const name = ns.metadata?.name || "unknown";
    const status = ns.status?.phase || "Unknown";
    const creationTime = ns.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";

    return [name, status, age];
  });

  return formatTable(headers, rows);
}

function formatNamespaceDescribe(ns: k8s.V1Namespace, resourceCounts?: Record<string, number>): string {
  let result = `Namespace: ${ns.metadata?.name}\n`;
  result += `Status: ${ns.status?.phase || "Unknown"}\n`;
  
  result += `\n--- Labels ---\n`;
  const labels = ns.metadata?.labels || {};
  if (Object.keys(labels).length === 0) {
    result += "  (none)\n";
  } else {
    Object.entries(labels).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  result += `\n--- Annotations ---\n`;
  const annotations = ns.metadata?.annotations || {};
  if (Object.keys(annotations).length === 0) {
    result += "  (none)\n";
  } else {
    Object.entries(annotations).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  if (resourceCounts) {
    result += `\n--- Resource Counts ---\n`;
    Object.entries(resourceCounts).forEach(([type, count]) => {
      result += `  ${type}: ${count}\n`;
    });
  }

  return result;
}

function formatResourceQuota(quota: any): string {
  let result = `ResourceQuota: ${quota.metadata?.namespace}/${quota.metadata?.name}\n`;
  
  result += `\n--- Hard Limits ---\n`;
  const hard = quota.spec?.hard || {};
  if (Object.keys(hard).length === 0) {
    result += "  (none)\n";
  } else {
    Object.entries(hard).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  result += `\n--- Used ---\n`;
  const used = quota.status?.used || {};
  if (Object.keys(used).length === 0) {
    result += "  (none)\n";
  } else {
    Object.entries(used).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  return result;
}

function formatLimitRange(lr: any): string {
  let result = `LimitRange: ${lr.metadata?.namespace}/${lr.metadata?.name}\n`;
  
  const items = lr.spec?.limits || [];
  items.forEach((item: any, i: number) => {
    result += `\n--- Limit #${i + 1} ---\n`;
    result += `Type: ${item.type}\n`;
    
    if (item.default) {
      result += `Default:\n`;
      Object.entries(item.default).forEach(([k, v]) => {
        result += `  ${k}: ${v}\n`;
      });
    }
    if (item.defaultRequest) {
      result += `Default Request:\n`;
      Object.entries(item.defaultRequest).forEach(([k, v]) => {
        result += `  ${k}: ${v}\n`;
      });
    }
    if (item.min) {
      result += `Min:\n`;
      Object.entries(item.min).forEach(([k, v]) => {
        result += `  ${k}: ${v}\n`;
      });
    }
    if (item.max) {
      result += `Max:\n`;
      Object.entries(item.max).forEach(([k, v]) => {
        result += `  ${k}: ${v}\n`;
      });
    }
  });

  return result;
}

async function handleK8sNamespace(params: K8sNamespaceParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi, appsApi } = createK8sClients(pluginConfig, params.context);

    switch (params.action) {
      case "list": {
        const response = await coreApi.listNamespace(
          undefined, undefined, undefined, undefined,
          params.label_selector
        );
        return formatNamespaceList(response.body.items);
      }

      case "describe": {
        if (!params.namespace) {
          throw new Error("namespace is required for describe action");
        }

        const nsResponse = await coreApi.readNamespace(params.namespace);
        
        let resourceCounts: Record<string, number> = {};
        try {
          const [pods, services, deployments, pvcs, configs, secrets] = await Promise.all([
            coreApi.listNamespacedPod(params.namespace),
            coreApi.listNamespacedService(params.namespace),
            appsApi.listNamespacedDeployment(params.namespace),
            coreApi.listNamespacedPersistentVolumeClaim(params.namespace),
            coreApi.listNamespacedConfigMap(params.namespace),
            coreApi.listNamespacedSecret(params.namespace),
          ]);

          resourceCounts = {
            "Pods": pods.body.items.length,
            "Services": services.body.items.length,
            "Deployments": deployments.body.items.length,
            "PVCs": pvcs.body.items.length,
            "ConfigMaps": configs.body.items.length,
            "Secrets": secrets.body.items.length,
          };
        } catch {
          // Some resources might not be accessible
        }

        return formatNamespaceDescribe(nsResponse.body, resourceCounts);
      }

      case "quota": {
        if (!params.namespace) {
          throw new Error("namespace is required for quota action");
        }

        const response = await coreApi.listNamespacedResourceQuota(params.namespace);
        const quotas = response.body.items;
        
        if (quotas.length === 0) {
          return `No ResourceQuota defined for namespace ${params.namespace}.`;
        }

        return quotas.map(formatResourceQuota).join("\n\n");
      }

      case "limits": {
        if (!params.namespace) {
          throw new Error("namespace is required for limits action");
        }

        const response = await coreApi.listNamespacedLimitRange(params.namespace);
        const limitRanges = response.body.items;
        
        if (limitRanges.length === 0) {
          return `No LimitRange defined for namespace ${params.namespace}.`;
        }

        return limitRanges.map(formatLimitRange).join("\n\n");
      }

      case "summary": {
        if (!params.namespace) {
          throw new Error("namespace is required for summary action");
        }

        const [pods, services, deployments, pvcs, configmaps, secrets] = await Promise.allSettled([
          coreApi.listNamespacedPod(params.namespace),
          coreApi.listNamespacedService(params.namespace),
          appsApi.listNamespacedDeployment(params.namespace),
          coreApi.listNamespacedPersistentVolumeClaim(params.namespace),
          coreApi.listNamespacedConfigMap(params.namespace),
          coreApi.listNamespacedSecret(params.namespace),
        ]);

        let result = `Namespace Summary: ${params.namespace}\n\n`;
        result += "Resource | Count\n";
        result += "----------|-------\n";
        
        if (pods.status === "fulfilled") {
          result += `Pods | ${pods.value.body.items.length}\n`;
        }
        if (services.status === "fulfilled") {
          result += `Services | ${services.value.body.items.length}\n`;
        }
        if (deployments.status === "fulfilled") {
          result += `Deployments | ${deployments.value.body.items.length}\n`;
        }
        if (pvcs.status === "fulfilled") {
          result += `PVCs | ${pvcs.value.body.items.length}\n`;
        }
        if (configmaps.status === "fulfilled") {
          result += `ConfigMaps | ${configmaps.value.body.items.length}\n`;
        }
        if (secrets.status === "fulfilled") {
          result += `Secrets | ${secrets.value.body.items.length}\n`;
        }

        return result;
      }

      case "create": {
        if (!params.namespace) {
          throw new Error("namespace is required for create action");
        }

        const ns: k8s.V1Namespace = {
          apiVersion: "v1",
          kind: "Namespace",
          metadata: {
            name: params.namespace,
            labels: params.labels as Record<string, string>,
          },
        };

        await coreApi.createNamespace(ns);
        return `Namespace ${params.namespace} created successfully.`;
      }

      case "label": {
        if (!params.namespace) {
          throw new Error("namespace is required for label action");
        }
        if (!params.labels) {
          throw new Error("labels are required for label action");
        }

        const current = await coreApi.readNamespace(params.namespace);
        
        const patch = {
          metadata: {
            labels: {
              ...current.body.metadata?.labels,
              ...params.labels,
            },
          },
        };

        await coreApi.patchNamespace(
          params.namespace,
          patch,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
        );

        return `Labels updated for namespace ${params.namespace}.`;
      }

      case "delete": {
        if (!params.namespace) {
          throw new Error("namespace is required for delete action");
        }

        await coreApi.deleteNamespace(params.namespace);
        return `Namespace ${params.namespace} deleted successfully. WARNING: All resources in this namespace have been deleted!`;
      }

      case "set_quota": {
        if (!params.namespace) {
          throw new Error("namespace is required for set_quota action");
        }
        if (!params.hard) {
          throw new Error("hard limits are required for set_quota action");
        }

        const quota: k8s.V1ResourceQuota = {
          apiVersion: "v1",
          kind: "ResourceQuota",
          metadata: {
            name: "default-quota",
            namespace: params.namespace,
          },
          spec: {
            hard: params.hard as Record<string, k8s.IntOrString>,
          },
        };

        try {
          await coreApi.replaceNamespacedResourceQuota("default-quota", params.namespace, quota);
          return `ResourceQuota updated for namespace ${params.namespace}.`;
        } catch {
          await coreApi.createNamespacedResourceQuota(params.namespace, quota);
          return `ResourceQuota created for namespace ${params.namespace}.`;
        }
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `namespace ${params.action}`));
  }
}

export function registerK8sNamespaceTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_namespace",
    description: "Kubernetes namespace operations: list, describe, quota, limits, create, delete",
    schema: K8sNamespaceSchema,
    handler: async (params: K8sNamespaceParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sNamespace(params, pluginConfig);
    },
  });
}

export { K8sNamespaceSchema, handleK8sNamespace };