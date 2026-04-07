import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { formatAge, formatTable } from "../lib/format.js";
import { wrapK8sError } from "../lib/errors.js";
import type { PluginConfig } from "../lib/types.js";

// Zod schema for k8s_config tool parameters
export const K8sConfigSchema = z.object({
  action: z.enum(["list_cm", "list_secret", "list_all", "describe_cm", "describe_secret", "get_cm_data", "get_secret_data", "list_keys", "update_cm", "create_secret", "delete_cm", "delete_secret"]),
  namespace: z.string().optional(),
  configmap_name: z.string().optional(),
  secret_name: z.string().optional(),
  key: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  data: z.record(z.string(), z.string()).optional(),
  secret_type: z.string().optional(),
  context: z.string().optional(),
});

type K8sConfigParams = z.infer<typeof K8sConfigSchema>;

// Base64 decode helper
function base64Decode(str: string): string {
  try {
    return Buffer.from(str, 'base64').toString('utf-8');
  } catch {
    return str;
  }
}

function formatConfigMapList(configMaps: k8s.V1ConfigMap[]): string {
  if (configMaps.length === 0) {
    return "No ConfigMaps found.";
  }

  const headers = ["NAMESPACE", "NAME", "DATA KEYS", "AGE"];
  const rows = configMaps.map((cm) => {
    const namespace = cm.metadata?.namespace || "unknown";
    const name = cm.metadata?.name || "unknown";
    const dataKeyCount = Object.keys(cm.data || {}).length;
    const binaryDataKeyCount = Object.keys(cm.binaryData || {}).length;
    const totalKeys = dataKeyCount + binaryDataKeyCount;
    const creationTime = cm.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";

    return [namespace, name, totalKeys.toString(), age];
  });

  return formatTable(headers, rows);
}

function formatSecretList(secrets: k8s.V1Secret[]): string {
  if (secrets.length === 0) {
    return "No Secrets found.";
  }

  const headers = ["NAMESPACE", "NAME", "TYPE", "DATA KEYS", "AGE"];
  const rows = secrets.map((secret) => {
    const namespace = secret.metadata?.namespace || "unknown";
    const name = secret.metadata?.name || "unknown";
    const type = secret.type || "Opaque";
    const dataKeys = Object.keys(secret.data || {}).length;
    const creationTime = secret.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";

    return [namespace, name, type, dataKeys.toString(), age];
  });

  return formatTable(headers, rows);
}

function formatConfigMapDescribe(cm: k8s.V1ConfigMap): string {
  let result = `ConfigMap: ${cm.metadata?.namespace}/${cm.metadata?.name}\n`;
  result += `Data Items: ${Object.keys(cm.data || {}).length}\n`;
  result += `Binary Data Items: ${Object.keys(cm.binaryData || {}).length}\n`;
  result += `\n--- Labels ---\n`;
  const labels = cm.metadata?.labels || {};
  if (Object.keys(labels).length === 0) {
    result += "  (none)\n";
  } else {
    Object.entries(labels).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  result += `\n--- Data ---\n`;
  const data = cm.data || {};
  if (Object.keys(data).length === 0) {
    result += "  (empty)\n";
  } else {
    Object.entries(data).forEach(([k, v]) => {
      const displayValue = v.length > 100 ? v.substring(0, 100) + "..." : v;
      result += `  ${k}: ${displayValue}\n`;
    });
  }

  return result;
}

function formatSecretDescribe(secret: k8s.V1Secret): string {
  let result = `Secret: ${secret.metadata?.namespace}/${secret.metadata?.name}\n`;
  result += `Type: ${secret.type || "Opaque"}\n`;
  result += `Data Items: ${Object.keys(secret.data || {}).length}\n`;
  result += `\n--- Labels ---\n`;
  const labels = secret.metadata?.labels || {};
  if (Object.keys(labels).length === 0) {
    result += "  (none)\n";
  } else {
    Object.entries(labels).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  result += `\n--- Data Keys ---\n`;
  const data = secret.data || {};
  if (Object.keys(data).length === 0) {
    result += "  (empty)\n";
  } else {
    Object.entries(data).forEach(([k, v]) => {
      const decoded = base64Decode(v || "");
      result += `  ${k} (${decoded.length} bytes)\n`;
    });
  }

  result += `\nUse 'get_secret_data' action with 'key' parameter to view a specific key's value.`;

  return result;
}

export async function handleK8sConfig(params: K8sConfigParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list_cm": {
        let configMaps: k8s.V1ConfigMap[];

        if (params.all_namespaces) {
          const response = await coreApi.listConfigMapForAllNamespaces(
            undefined, undefined, undefined, params.label_selector
          );
          configMaps = response.body.items;
        } else {
          const response = await coreApi.listNamespacedConfigMap(
            namespace,
            undefined, undefined, undefined, undefined,
            params.label_selector
          );
          configMaps = response.body.items;
        }

        return formatConfigMapList(configMaps);
      }

      case "list_secret": {
        let secrets: k8s.V1Secret[];

        if (params.all_namespaces) {
          const response = await coreApi.listSecretForAllNamespaces(
            undefined, undefined, undefined, params.label_selector
          );
          secrets = response.body.items;
        } else {
          const response = await coreApi.listNamespacedSecret(
            namespace,
            undefined, undefined, undefined, undefined,
            params.label_selector
          );
          secrets = response.body.items;
        }

        return formatSecretList(secrets);
      }

      case "list_all": {
        const cmList = await coreApi.listNamespacedConfigMap(namespace, undefined, undefined, undefined, undefined, params.label_selector);
        const secretList = await coreApi.listNamespacedSecret(namespace, undefined, undefined, undefined, undefined, params.label_selector);
        
        let result = "=== ConfigMaps ===\n";
        result += formatConfigMapList(cmList.body.items);
        result += "\n\n=== Secrets ===\n";
        result += formatSecretList(secretList.body.items);
        return result;
      }

      case "describe_cm": {
        if (!params.configmap_name) {
          throw new Error("configmap_name is required");
        }
        const response = await coreApi.readNamespacedConfigMap(params.configmap_name, namespace);
        return formatConfigMapDescribe(response.body);
      }

      case "describe_secret": {
        if (!params.secret_name) {
          throw new Error("secret_name is required");
        }
        const response = await coreApi.readNamespacedSecret(params.secret_name, namespace);
        return formatSecretDescribe(response.body);
      }

      case "get_cm_data": {
        if (!params.configmap_name) {
          throw new Error("configmap_name is required");
        }
        const response = await coreApi.readNamespacedConfigMap(params.configmap_name, namespace);
        const data = response.body.data || {};
        
        if (params.key) {
          if (data[params.key] === undefined) {
            return `Key '${params.key}' not found. Available keys: ${Object.keys(data).join(", ")}`;
          }
          return data[params.key] || "(empty)";
        }
        
        if (Object.keys(data).length === 0) {
          return "(empty ConfigMap)";
        }
        
        let result = `ConfigMap: ${namespace}/${params.configmap_name}\n`;
        result += `--- Data ---\n`;
        Object.entries(data).forEach(([k, v]) => {
          result += `${k}:\n${v}\n\n`;
        });
        return result;
      }

      case "get_secret_data": {
        if (!params.secret_name) {
          throw new Error("secret_name is required");
        }
        const response = await coreApi.readNamespacedSecret(params.secret_name, namespace);
        const data = response.body.data || {};

        if (params.key) {
          if (data[params.key] === undefined) {
            return `Key '${params.key}' not found. Available keys: ${Object.keys(data).join(", ")}`;
          }
          return base64Decode(data[params.key] || "");
        }

        if (Object.keys(data).length === 0) {
          return "(empty Secret)";
        }

        // Without a specific key, show only key names and sizes to avoid leaking secrets
        let result = `Secret: ${namespace}/${params.secret_name}\n`;
        result += `--- Data Keys ---\n`;
        Object.entries(data).forEach(([k, v]) => {
          const decoded = base64Decode(v || "");
          result += `${k} (${decoded.length} bytes)\n`;
        });
        result += `\nUse 'key' parameter to view full value of a specific key.`;
        return result;
      }

      case "list_keys": {
        if (params.configmap_name) {
          const response = await coreApi.readNamespacedConfigMap(params.configmap_name, namespace);
          const dataKeys = Object.keys(response.body.data || {});
          const binaryKeys = Object.keys(response.body.binaryData || {});
          return `Keys in ${namespace}/${params.configmap_name}:\n- Data: ${dataKeys.join(", ") || "(none)"}\n- Binary: ${binaryKeys.join(", ") || "(none)"}`;
        } else if (params.secret_name) {
          const response = await coreApi.readNamespacedSecret(params.secret_name, namespace);
          const dataKeys = Object.keys(response.body.data || {});
          return `Keys in ${namespace}/${params.secret_name}: ${dataKeys.join(", ") || "(none)"}`;
        }
        throw new Error("configmap_name or secret_name is required");
      }

      case "update_cm": {
        if (!params.configmap_name) {
          throw new Error("configmap_name is required");
        }
        if (!params.data) {
          throw new Error("data is required for update_cm");
        }
        
        const current = await coreApi.readNamespacedConfigMap(params.configmap_name, namespace);
        const patch: k8s.V1ConfigMap = {
          ...current.body,
          data: { ...current.body.data, ...params.data },
        };
        await coreApi.replaceNamespacedConfigMap(params.configmap_name, namespace, patch);
        return `ConfigMap ${namespace}/${params.configmap_name} updated successfully.`;
      }

      case "create_secret": {
        if (!params.secret_name) {
          throw new Error("secret_name is required");
        }
        if (!params.data) {
          throw new Error("data is required for create_secret");
        }
        
        // Encode data to base64
        const encodedData: Record<string, string> = {};
        Object.entries(params.data).forEach(([k, v]) => {
          encodedData[k] = Buffer.from(v as string).toString('base64');
        });
        
        const secret: k8s.V1Secret = {
          apiVersion: "v1",
          kind: "Secret",
          metadata: {
            name: params.secret_name,
            namespace: namespace,
          },
          type: params.secret_type || "Opaque",
          data: encodedData,
        };
        
        await coreApi.createNamespacedSecret(namespace, secret);
        return `Secret ${namespace}/${params.secret_name} created successfully.`;
      }

      case "delete_cm": {
        if (!params.configmap_name) {
          throw new Error("configmap_name is required");
        }
        await coreApi.deleteNamespacedConfigMap(params.configmap_name, namespace);
        return `ConfigMap ${namespace}/${params.configmap_name} deleted successfully.`;
      }

      case "delete_secret": {
        if (!params.secret_name) {
          throw new Error("secret_name is required");
        }
        await coreApi.deleteNamespacedSecret(params.secret_name, namespace);
        return `Secret ${namespace}/${params.secret_name} deleted successfully.`;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `config ${params.action}`));
  }
}
