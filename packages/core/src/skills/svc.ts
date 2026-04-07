import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { formatAge, formatTable } from "../lib/format.js";
import { wrapK8sError } from "../lib/errors.js";
import type { PluginConfig } from "../lib/types.js";

// Zod schema for k8s_svc tool parameters
export const K8sSvcSchema = z.object({
  action: z.enum(["list", "describe", "endpoints", "status"]),
  namespace: z.string().optional(),
  service_name: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  context: z.string().optional(),
});

type K8sSvcParams = z.infer<typeof K8sSvcSchema>;

function formatServiceList(services: k8s.V1Service[]): string {
  if (services.length === 0) {
    return "No services found.";
  }

  const headers = ["NAMESPACE", "NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"];
  const rows = services.map((svc) => {
    const namespace = svc.metadata?.namespace || "unknown";
    const name = svc.metadata?.name || "unknown";
    const type = svc.spec?.type || "ClusterIP";
    const clusterIP = svc.spec?.clusterIP || "None";

    const externalIPs = svc.status?.loadBalancer?.ingress?.map((i) => i.ip || i.hostname) || [];
    const externalIP = externalIPs.length > 0 ? externalIPs.join(",") : "<none>";

    const ports =
      svc.spec?.ports?.map((p) => {
        if (p.nodePort) {
          return `${p.port}:${p.nodePort}/${p.protocol}`;
        }
        return `${p.port}/${p.protocol}`;
      }) || [];
    const portsStr = ports.join(",") || "<none>";

    const creationTime = svc.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";

    return [namespace, name, type, clusterIP, externalIP, portsStr, age];
  });

  return formatTable(headers, rows);
}

function formatServiceStatus(service: k8s.V1Service, endpoints?: k8s.V1Endpoints): string {
  const name = service.metadata?.name || "unknown";
  const namespace = service.metadata?.namespace || "unknown";

  let result = `Service: ${namespace}/${name}\n`;
  result += `Type: ${service.spec?.type || "ClusterIP"}\n`;
  result += `Cluster IP: ${service.spec?.clusterIP || "None"}\n`;

  const externalIPs = service.status?.loadBalancer?.ingress?.map((i) => i.ip || i.hostname) || [];
  if (externalIPs.length > 0) {
    result += `External IP: ${externalIPs.join(", ")}\n`;
  }

  result += `\nPorts:\n`;
  const ports = service.spec?.ports || [];
  ports.forEach((p) => {
    result += `  ${p.name || "unnamed"}: ${p.port}/${p.protocol}`;
    if (p.targetPort) {
      result += ` → ${p.targetPort}`;
    }
    if (p.nodePort) {
      result += ` (NodePort: ${p.nodePort})`;
    }
    result += "\n";
  });

  if (endpoints) {
    const endpointCount = endpoints.subsets?.reduce((count, subset) => {
      return count + (subset.addresses?.length || 0);
    }, 0) || 0;

    result += `\nEndpoints: ${endpointCount}\n`;
  }

  return result;
}

function formatServiceDescribe(service: k8s.V1Service, endpoints?: k8s.V1Endpoints): string {
  const name = service.metadata?.name || "unknown";
  const namespace = service.metadata?.namespace || "unknown";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `Labels:\n`;
  const labels = service.metadata?.labels || {};
  if (Object.keys(labels).length === 0) {
    result += `  <none>\n`;
  } else {
    Object.entries(labels).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  result += `\n--- Selector ---\n`;
  const selector = service.spec?.selector || {};
  if (Object.keys(selector).length === 0) {
    result += `  <none>\n`;
  } else {
    Object.entries(selector).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  result += `\n--- Type ---\n`;
  result += `  ${service.spec?.type || "ClusterIP"}\n`;

  result += `\n--- IP Addresses ---\n`;
  result += `  Cluster IP: ${service.spec?.clusterIP || "None"}\n`;

  const externalIPs = service.status?.loadBalancer?.ingress?.map((i) => i.ip || i.hostname) || [];
  if (externalIPs.length > 0) {
    result += `  External IP: ${externalIPs.join(", ")}\n`;
  }

  result += `\n--- Ports ---\n`;
  const ports = service.spec?.ports || [];
  ports.forEach((p) => {
    result += `  ${p.name || "unnamed"}:\n`;
    result += `    Port: ${p.port}\n`;
    result += `    TargetPort: ${p.targetPort || p.port}\n`;
    result += `    Protocol: ${p.protocol}\n`;
    if (p.nodePort) {
      result += `    NodePort: ${p.nodePort}\n`;
    }
  });

  result += `\n--- Session Affinity ---\n`;
  result += `  ${service.spec?.sessionAffinity || "None"}\n`;

  if (endpoints) {
    result += `\n--- Endpoints ---\n`;
    const subsets = endpoints.subsets || [];
    if (subsets.length === 0) {
      result += `  <none>\n`;
    } else {
      subsets.forEach((subset) => {
        const addresses = subset.addresses || [];
        const ports = subset.ports || [];

        addresses.forEach((addr) => {
          const targetRef = addr.targetRef;
          const podName = targetRef?.name || "unknown";
          const portsList = ports.map((p) => `${p.name}:${p.port}`).join(", ");
          result += `  ${addr.ip} (${podName}) [${portsList}]\n`;
        });
      });
    }
  }

  return result;
}

function formatEndpoints(endpoints: k8s.V1Endpoints): string {
  const name = endpoints.metadata?.name || "unknown";
  const namespace = endpoints.metadata?.namespace || "unknown";

  let result = `Endpoints for ${namespace}/${name}:\n\n`;

  const subsets = endpoints.subsets || [];
  if (subsets.length === 0) {
    return result + "No endpoints available";
  }

  subsets.forEach((subset, idx) => {
    if (idx > 0) result += "\n";

    const addresses = subset.addresses || [];
    const notReadyAddresses = subset.notReadyAddresses || [];
    const ports = subset.ports || [];

    if (addresses.length > 0) {
      result += `Ready Endpoints (${addresses.length}):\n`;
      addresses.forEach((addr) => {
        const targetRef = addr.targetRef;
        const podName = targetRef?.name || "unknown";
        const portsList = ports.map((p) => `${p.name || "unnamed"}:${p.port}`).join(", ");
        result += `  ${addr.ip} → ${podName} [${portsList}]\n`;
      });
    }

    if (notReadyAddresses.length > 0) {
      result += `\nNot Ready Endpoints (${notReadyAddresses.length}):\n`;
      notReadyAddresses.forEach((addr) => {
        const targetRef = addr.targetRef;
        const podName = targetRef?.name || "unknown";
        result += `  ${addr.ip} → ${podName} (NOT READY)\n`;
      });
    }
  });

  return result;
}

export async function handleK8sSvc(params: K8sSvcParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi } = createK8sClients(pluginConfig, params.context);

    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let services: k8s.V1Service[];

        if (params.all_namespaces) {
          const response = await coreApi.listServiceForAllNamespaces(
            undefined,
            undefined,
            undefined,
            params.label_selector
          );
          services = response.body.items;
        } else {
          const response = await coreApi.listNamespacedService(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            params.label_selector
          );
          services = response.body.items;
        }

        return formatServiceList(services);
      }

      case "status": {
        if (!params.service_name) {
          throw new Error("service_name is required for status action");
        }

        const svcResponse = await coreApi.readNamespacedService(params.service_name, namespace);

        let endpoints: k8s.V1Endpoints | undefined;
        try {
          const epResponse = await coreApi.readNamespacedEndpoints(params.service_name, namespace);
          endpoints = epResponse.body;
        } catch (err) {
          // Endpoints might not exist
        }

        return formatServiceStatus(svcResponse.body, endpoints);
      }

      case "describe": {
        if (!params.service_name) {
          throw new Error("service_name is required for describe action");
        }

        const svcResponse = await coreApi.readNamespacedService(params.service_name, namespace);

        let endpoints: k8s.V1Endpoints | undefined;
        try {
          const epResponse = await coreApi.readNamespacedEndpoints(params.service_name, namespace);
          endpoints = epResponse.body;
        } catch (err) {
          // Endpoints might not exist
        }

        return formatServiceDescribe(svcResponse.body, endpoints);
      }

      case "endpoints": {
        if (!params.service_name) {
          throw new Error("service_name is required for endpoints action");
        }

        const epResponse = await coreApi.readNamespacedEndpoints(params.service_name, namespace);
        return formatEndpoints(epResponse.body);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `svc ${params.action}`));
  }
}
