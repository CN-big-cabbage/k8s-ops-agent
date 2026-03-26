import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatAge, formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// Zod schema for k8s_storage tool parameters
const K8sStorageSchema = z.object({
  action: z.enum(["list_pvc", "describe_pvc", "capacity_pvc", "list_pv", "describe_pv", "describe_storage_class", "list_storage_class", "create_pvc", "delete_pvc", "usage_report", "find_pods", "resize_pvc"]),
  namespace: z.string().optional(),
  pvc_name: z.string().optional(),
  pv_name: z.string().optional(),
  storage_class: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  status: z.string().optional(),
  storage_request: z.string().optional(),
  access_modes: z.array(z.string()).optional(),
  new_size: z.string().optional(),
  context: z.string().optional(),
});

type K8sStorageParams = z.infer<typeof K8sStorageSchema>;

function formatPVCList(pvcs: k8s.V1PersistentVolumeClaim[]): string {
  if (pvcs.length === 0) {
    return "No PersistentVolumeClaims found.";
  }

  const headers = ["NAMESPACE", "NAME", "STATUS", "VOLUME", "CAPACITY", "CLASS", "AGE"];
  const rows = pvcs.map((pvc) => {
    const namespace = pvc.metadata?.namespace || "unknown";
    const name = pvc.metadata?.name || "unknown";
    const status = pvc.status?.phase || "Unknown";
    const volume = pvc.spec?.volumeName || "-";
    const capacity = pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage || "-";
    const storageClass = pvc.spec?.storageClassName || "-";
    const creationTime = pvc.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";

    return [namespace, name, status, volume, capacity, storageClass, age];
  });

  return formatTable(headers, rows);
}

function formatPVList(pvs: any[]): string {
  if (pvs.length === 0) {
    return "No PersistentVolumes found.";
  }

  const headers = ["NAME", "CAPACITY", "ACCESS MODES", "RECLAIM POLICY", "STATUS", "CLAIM", "CLASS", "AGE"];
  const rows = pvs.map((pv) => {
    const name = pv.metadata?.name || "unknown";
    const capacity = pv.spec?.capacity?.storage || "-";
    const accessModes = pv.spec?.accessModes?.join(", ") || "-";
    const reclaimPolicy = pv.spec?.persistentVolumeReclaimPolicy || "-";
    const status = pv.status?.phase || "Unknown";
    const claim = pv.spec?.claimRef?.namespace ? `${pv.spec.claimRef.namespace}/${pv.spec.claimRef.name}` : "-";
    const storageClass = pv.spec?.storageClassName || "-";
    const creationTime = pv.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";

    return [name, capacity, accessModes, reclaimPolicy, status, claim, storageClass, age];
  });

  return formatTable(headers, rows);
}

function formatPVCDescribe(pvc: k8s.V1PersistentVolumeClaim): string {
  let result = `PersistentVolumeClaim: ${pvc.metadata?.namespace}/${pvc.metadata?.name}\n`;
  result += `Status: ${pvc.status?.phase || "Unknown"}\n`;
  result += `Volume: ${pvc.spec?.volumeName || "none"}\n`;
  result += `Storage Class: ${pvc.spec?.storageClassName || "(default)"}\n`;
  result += `Requested: ${pvc.spec?.resources?.requests?.storage || "none"}\n`;
  result += `Allocated: ${pvc.status?.capacity?.storage || "none"}\n`;
  
  result += `\n--- Access Modes ---\n`;
  result += `  ${pvc.spec?.accessModes?.join(", ") || "None"}\n`;
  
  result += `\n--- Labels ---\n`;
  const labels = pvc.metadata?.labels || {};
  if (Object.keys(labels).length === 0) {
    result += "  (none)\n";
  } else {
    Object.entries(labels).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  return result;
}

function formatStorageClass(sc: any): string {
  let result = `StorageClass: ${sc.metadata?.name}\n`;
  result += `Provisioner: ${sc.provisioner}\n`;
  result += `Reclaim Policy: ${sc.reclaimPolicy || "Delete"}\n`;
  result += `Volume Binding Mode: ${sc.volumeBindingMode || "Immediate"}\n`;
  result += `Allow Volume Expansion: ${sc.allowVolumeExpansion === true ? "Yes" : "No"}\n`;
  
  result += `\n--- Parameters ---\n`;
  const params = sc.parameters || {};
  if (Object.keys(params).length === 0) {
    result += "  (none)\n";
  } else {
    Object.entries(params).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  return result;
}

async function handleK8sStorage(params: K8sStorageParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi, storageApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list_pvc": {
        let pvcs: k8s.V1PersistentVolumeClaim[];

        if (params.all_namespaces) {
          const response = await coreApi.listPersistentVolumeClaimForAllNamespaces();
          pvcs = response.body.items;
        } else {
          const response = await coreApi.listNamespacedPersistentVolumeClaim(namespace);
          pvcs = response.body.items;
        }

        if (params.storage_class) {
          pvcs = pvcs.filter(p => p.spec?.storageClassName === params.storage_class);
        }
        if (params.status) {
          pvcs = pvcs.filter(p => p.status?.phase === params.status);
        }

        return formatPVCList(pvcs);
      }

      case "describe_pvc": {
        if (!params.pvc_name) {
          throw new Error("pvc_name is required for describe_pvc action");
        }
        const response = await coreApi.readNamespacedPersistentVolumeClaim(params.pvc_name, namespace);
        return formatPVCDescribe(response.body);
      }

      case "capacity_pvc": {
        if (!params.pvc_name) {
          throw new Error("pvc_name is required for capacity_pvc action");
        }
        const response = await coreApi.readNamespacedPersistentVolumeClaim(params.pvc_name, namespace);
        const pvc = response.body;
        
        let result = `Capacity for ${namespace}/${params.pvc_name}:\n`;
        result += `  Requested: ${pvc.spec?.resources?.requests?.storage || "unknown"}\n`;
        result += `  Allocated: ${pvc.status?.capacity?.storage || "not yet bound"}\n`;
        
        return result;
      }

      case "list_pv": {
        const response = await coreApi.listPersistentVolume();
        let pvs = response.body.items;
        
        if (params.storage_class) {
          pvs = pvs.filter(p => p.spec?.storageClassName === params.storage_class);
        }

        return formatPVList(pvs);
      }

      case "describe_pv": {
        if (!params.pv_name) {
          throw new Error("pv_name is required for describe_pv action");
        }
        const response = await coreApi.readPersistentVolume(params.pv_name);
        const pv = response.body;
        
        let result = `PersistentVolume: ${pv.metadata?.name}\n`;
        result += `Status: ${pv.status?.phase || "Unknown"}\n`;
        result += `Capacity: ${pv.spec?.capacity?.storage || "unknown"}\n`;
        result += `Access Modes: ${pv.spec?.accessModes?.join(", ") || "none"}\n`;
        result += `Reclaim Policy: ${pv.spec?.persistentVolumeReclaimPolicy || "Delete"}\n`;
        result += `Storage Class: ${pv.spec?.storageClassName || "(none)"}\n`;
        
        return result;
      }

      case "describe_storage_class": {
        if (!params.storage_class) {
          throw new Error("storage_class is required for describe_storage_class action");
        }
        const response = await storageApi.readStorageClass(params.storage_class);
        return formatStorageClass(response.body);
      }

      case "list_storage_class": {
        const response = await storageApi.listStorageClass();
        
        const scs = response.body.items;
        if (scs.length === 0) {
          return "No StorageClasses found.";
        }

        const headers = ["NAME", "PROVISIONER", "RECLAIM POLICY", "BINDING MODE", "EXPANSION"];
        const rows = scs.map((sc) => {
          return [
            sc.metadata?.name || "unknown",
            sc.provisioner || "unknown",
            sc.reclaimPolicy || "Delete",
            sc.volumeBindingMode || "Immediate",
            sc.allowVolumeExpansion === true ? "Yes" : "No",
          ];
        });

        return formatTable(headers, rows);
      }

      case "create_pvc": {
        if (!params.pvc_name) {
          throw new Error("pvc_name is required for create_pvc action");
        }
        if (!params.storage_request) {
          throw new Error("storage_request is required for create_pvc action");
        }

        const pvc: k8s.V1PersistentVolumeClaim = {
          apiVersion: "v1",
          kind: "PersistentVolumeClaim",
          metadata: {
            name: params.pvc_name,
            namespace: namespace,
          },
          spec: {
            accessModes: params.access_modes || ["ReadWriteOnce"],
            resources: {
              requests: {
                storage: params.storage_request,
              },
            },
          },
        };

        if (params.storage_class) {
          pvc.spec!.storageClassName = params.storage_class;
        }

        await coreApi.createNamespacedPersistentVolumeClaim(namespace, pvc);
        return `PersistentVolumeClaim ${namespace}/${params.pvc_name} created successfully.`;
      }

      case "delete_pvc": {
        if (!params.pvc_name) {
          throw new Error("pvc_name is required for delete_pvc action");
        }
        await coreApi.deleteNamespacedPersistentVolumeClaim(params.pvc_name, namespace);
        return `PersistentVolumeClaim ${namespace}/${params.pvc_name} deleted successfully.`;
      }

      case "usage_report": {
        const allNs = await coreApi.listNamespace();
        const nsNames = allNs.body.items.map(ns => ns.metadata!.name!);
        
        let result = "Storage Usage Report\n\n";
        result += "NAMESPACE | PVCS | TOTAL REQUESTED | TOTAL BOUND\n";
        result += "-----------|------|-----------------|------------\n";
        
        const storageClassTotals: Record<string, { total: number, used: number }> = {};
        
        for (const ns of nsNames.slice(0, 30)) {
          try {
            const resp = await coreApi.listNamespacedPersistentVolumeClaim(ns);
            const pvcs = resp.body.items;
            
            if (pvcs.length === 0) continue;
            
            let totalRequested = 0;
            let boundCount = 0;
            
            pvcs.forEach(pvc => {
              const requested = pvc.spec?.resources?.requests?.storage || "0";
              const size = parseSize(requested);
              totalRequested += size;
              
              if (pvc.status?.phase === "Bound") {
                boundCount++;
                
                const sc = pvc.spec?.storageClassName || "default";
                storageClassTotals[sc] = (storageClassTotals[sc] || { total: 0, used: 0 });
                storageClassTotals[sc].total += size;
              }
            });
            
            const nsDisplay = ns.length > 12 ? ns.substring(0, 9) + "..." : ns;
            result += `${nsDisplay.padEnd(12)} | ${pvcs.length.toString().padEnd(4)} | ${formatBytes(totalRequested).padEnd(15)} | ${boundCount}\n`;
          } catch {
            // Skip
          }
        }

        if (Object.keys(storageClassTotals).length > 0) {
          result += "\n--- By Storage Class ---\n";
          Object.entries(storageClassTotals).forEach(([sc, data]) => {
            result += `  ${sc}: ${formatBytes(data.total)} used\n`;
          });
        }

        return result;
      }

      case "find_pods": {
        if (!params.pvc_name) {
          throw new Error("pvc_name is required for find_pods action");
        }
        
        const pvc = await coreApi.readNamespacedPersistentVolumeClaim(params.pvc_name, namespace);
        const pvName = pvc.body.spec?.volumeName;
        
        if (!pvName) {
          return `PVC ${namespace}/${params.pvc_name} is not bound to any volume yet.`;
        }
        
        const podsResponse = await coreApi.listNamespacedPod(namespace);
        const pods = podsResponse.body.items.filter(pod => {
          const volumes = pod.spec?.volumes || [];
          return volumes.some(v => v.persistentVolumeClaim?.claimName === params.pvc_name);
        });
        
        if (pods.length === 0) {
          return `No pods found using PVC ${namespace}/${params.pvc_name}.`;
        }
        
        let result = `Pods using PVC ${namespace}/${params.pvc_name}:\n\n`;
        pods.forEach(pod => {
          result += `  - ${pod.metadata?.name} (${pod.status?.phase})\n`;
        });
        
        return result;
      }

      case "resize_pvc": {
        if (!params.pvc_name) {
          throw new Error("pvc_name is required for resize_pvc action");
        }
        if (!params.new_size) {
          throw new Error("new_size is required for resize_pvc action");
        }
        
        const current = await coreApi.readNamespacedPersistentVolumeClaim(params.pvc_name, namespace);
        
        const patch = {
          spec: {
            resources: {
              requests: {
                storage: params.new_size,
              },
            },
          },
        };
        
        await coreApi.patchNamespacedPersistentVolumeClaim(
          params.pvc_name,
          namespace,
          patch,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
        );
        
        return `PVC ${namespace}/${params.pvc_name} resize request submitted. New size: ${params.new_size}. Note: Resize may require pod restart.`;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `storage ${params.action}`));
  }
}

function parseSize(sizeStr: string): number {
  if (!sizeStr) return 0;
  
  const match = sizeStr.match(/^(\d+)(Ki|Mi|Gi|Ti|Pi|Ei|K|M|G|T|P|E)?/);
  if (!match) return 0;
  
  const value = parseInt(match[1]);
  const unit = match[2] || "";
  
  const multipliers: Record<string, number> = {
    "Ki": 1024,
    "Mi": 1024 * 1024,
    "Gi": 1024 * 1024 * 1024,
    "Ti": 1024 * 1024 * 1024 * 1024,
    "Pi": 1024 * 1024 * 1024 * 1024 * 1024,
    "Ei": 1024 * 1024 * 1024 * 1024 * 1024 * 1024,
    "K": 1000,
    "M": 1000 * 1000,
    "G": 1000 * 1000 * 1000,
    "T": 1000 * 1000 * 1000 * 1000,
    "P": 1000 * 1000 * 1000 * 1000 * 1000,
    "E": 1000 * 1000 * 1000 * 1000 * 1000 * 1000,
  };
  
  return value * (multipliers[unit] || 1);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0";
  
  const units = ["B", "Ki", "Mi", "Gi", "Ti", "Pi"];
  let unitIndex = 0;
  let size = bytes;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)}${units[unitIndex]}`;
}

export function registerK8sStorageTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_storage",
    description: "Kubernetes storage operations: PVC, PV, StorageClass management",
    schema: K8sStorageSchema,
    handler: async (params: K8sStorageParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sStorage(params, pluginConfig);
    },
  });
}

export { K8sStorageSchema, handleK8sStorage };