import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatAge, formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

// Zod schema for k8s_ingress tool parameters
const K8sIngressSchema = z.object({
  action: z.enum(["list", "describe", "rules", "tls", "annotations", "update", "add_annotation", "delete", "health"]),
  namespace: z.string().optional(),
  ingress_name: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  rules: z.array(z.object({
    host: z.string(),
    paths: z.array(z.object({
      path: z.string(),
      service: z.string(),
      service_port: z.number().or(z.string()),
    })),
  })).optional(),
  tls: z.array(z.object({
    hosts: z.array(z.string()),
    secret_name: z.string(),
  })).optional(),
  annotation: z.string().optional(),
  value: z.string().optional(),
  context: z.string().optional(),
});

type K8sIngressParams = z.infer<typeof K8sIngressSchema>;

interface IngressRule {
  host?: string;
  http?: {
    paths: Array<{
      path?: string;
      pathType?: string;
      backend?: {
        service?: {
          name?: string;
          port?: {
            number?: number;
            name?: string;
          };
        };
      };
    }>;
  };
}

function formatIngressList(ingresses: any[]): string {
  if (ingresses.length === 0) {
    return "No Ingresses found.";
  }

  const headers = ["NAMESPACE", "NAME", "HOSTS", "ADDRESS", "AGE"];
  const rows = ingresses.map((ing: any) => {
    const namespace = ing.metadata?.namespace || "unknown";
    const name = ing.metadata?.name || "unknown";
    const rules = ing.spec?.rules || [];
    const hosts = rules.map((r: IngressRule) => r.host).filter(Boolean).join(", ") || "*";
    const address = ing.status?.loadBalancer?.ingress?.[0]?.ip || ing.status?.loadBalancer?.ingress?.[0]?.hostname || "-";
    const creationTime = ing.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";

    const displayHosts = hosts.length > 30 ? hosts.substring(0, 27) + "..." : hosts;

    return [namespace, name, displayHosts, address, age];
  });

  return formatTable(headers, rows);
}

function formatIngressDescribe(ingress: any): string {
  let result = `Ingress: ${ingress.metadata?.namespace}/${ingress.metadata?.name}\n`;
  result += `Class: ${ingress.spec?.ingressClassName || "default"}\n`;
  result += `\n--- Labels ---\n`;
  const labels = ingress.metadata?.labels || {};
  if (Object.keys(labels).length === 0) {
    result += "  (none)\n";
  } else {
    Object.entries(labels).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  result += `\n--- TLS ---\n`;
  const tls = ingress.spec?.tls || [];
  if (tls.length === 0) {
    result += "  (none)\n";
  } else {
    tls.forEach((t: any) => {
      result += `  Hosts: ${t.hosts?.join(", ") || "all"}\n`;
      result += `  Secret: ${t.secretName || "none"}\n\n`;
    });
  }

  result += `\n--- Rules ---\n`;
  const rules = ingress.spec?.rules || [];
  if (rules.length === 0) {
    result += "  (no rules defined)\n";
  } else {
    rules.forEach((rule: IngressRule) => {
      result += `  Host: ${rule.host || "all hosts"}\n`;
      const http = rule.http?.paths || [];
      http.forEach((p: any) => {
        result += `    Path: ${p.path || "/"} → ${p.backend?.service?.name}:${p.backend?.service?.port?.number || p.backend?.service?.port?.name || "80"}\n`;
      });
    });
  }

  result += `\n--- Annotations ---\n`;
  const annotations = ingress.metadata?.annotations || {};
  if (Object.keys(annotations).length === 0) {
    result += "  (none)\n";
  } else {
    Object.entries(annotations).forEach(([k, v]) => {
      result += `  ${k}: ${v}\n`;
    });
  }

  result += `\n--- Status ---\n`;
  const lb = ingress.status?.loadBalancer?.ingress?.[0];
  if (lb) {
    result += `  IP: ${lb.ip || "none"}\n`;
    result += `  Hostname: ${lb.hostname || "none"}\n`;
  } else {
    result += "  (no load balancer status)\n";
  }

  return result;
}

function formatIngressRules(ingress: any): string {
  let result = `Routing Rules for: ${ingress.metadata?.namespace}/${ingress.metadata?.name}\n\n`;
  
  const rules = ingress.spec?.rules || [];
  if (rules.length === 0) {
    return result + "No rules defined.";
  }

  rules.forEach((rule: IngressRule) => {
    result += `Host: ${rule.host || "(all hosts)"}\n`;
    const http = rule.http?.paths || [];
    http.forEach((p: any) => {
      const serviceName = p.backend?.service?.name || "unknown";
      const servicePort = p.backend?.service?.port?.number || p.backend?.service?.port?.name || 80;
      const path = p.path || "/";
      result += `  ${path} → ${serviceName}:${servicePort}`;
      if (p.pathType) {
        result += ` (${p.pathType})`;
      }
      result += "\n";
    });
    result += "\n";
  });

  return result;
}

function formatIngressTLS(ingress: any): string {
  let result = `TLS Configuration for: ${ingress.metadata?.namespace}/${ingress.metadata?.name}\n\n`;
  
  const tls = ingress.spec?.tls || [];
  if (tls.length === 0) {
    return result + "No TLS configured.";
  }

  tls.forEach((t: any, i: number) => {
    result += `TLS #${i + 1}:\n`;
    result += `  Hosts: ${t.hosts?.join(", ") || "(all hosts)"}\n`;
    result += `  Secret: ${t.secretName || "(none)"}\n\n`;
  });

  return result;
}

function formatIngressAnnotations(ingress: any): string {
  let result = `Annotations for: ${ingress.metadata?.namespace}/${ingress.metadata?.name}\n\n`;
  
  const annotations = ingress.metadata?.annotations || {};
  if (Object.keys(annotations).length === 0) {
    return result + "No annotations.";
  }

  Object.entries(annotations).forEach(([k, v]) => {
    result += `${k}: ${v}\n`;
  });

  return result;
}

async function handleK8sIngress(params: K8sIngressParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { networkingApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let ingresses: any[];
        
        if (params.all_namespaces) {
          const response = await networkingApi.listIngressForAllNamespaces(
            undefined, undefined, undefined, undefined, params.label_selector
          );
          ingresses = response.body.items;
        } else {
          const response = await networkingApi.listNamespacedIngress(
            namespace,
            undefined, undefined, undefined, undefined,
            params.label_selector
          );
          ingresses = response.body.items;
        }

        return formatIngressList(ingresses);
      }

      case "describe": {
        if (!params.ingress_name) {
          throw new Error("ingress_name is required for describe action");
        }
        const response = await networkingApi.readNamespacedIngress(params.ingress_name, namespace);
        return formatIngressDescribe(response.body);
      }

      case "rules": {
        if (!params.ingress_name) {
          throw new Error("ingress_name is required for rules action");
        }
        const response = await networkingApi.readNamespacedIngress(params.ingress_name, namespace);
        return formatIngressRules(response.body);
      }

      case "tls": {
        if (!params.ingress_name) {
          throw new Error("ingress_name is required for tls action");
        }
        const response = await networkingApi.readNamespacedIngress(params.ingress_name, namespace);
        return formatIngressTLS(response.body);
      }

      case "annotations": {
        if (!params.ingress_name) {
          throw new Error("ingress_name is required for annotations action");
        }
        const response = await networkingApi.readNamespacedIngress(params.ingress_name, namespace);
        return formatIngressAnnotations(response.body);
      }

      case "update": {
        if (!params.ingress_name) {
          throw new Error("ingress_name is required for update action");
        }

        const current = await networkingApi.readNamespacedIngress(params.ingress_name, namespace);
        const ingress = current.body as any;

        // Update rules if provided
        if (params.rules) {
          ingress.spec = ingress.spec || {};
          ingress.spec.rules = params.rules.map(r => ({
            host: r.host,
            http: {
              paths: r.paths.map(p => ({
                path: p.path,
                pathType: "Prefix",
                backend: {
                  service: {
                    name: p.service,
                    port: {
                      number: typeof p.service_port === 'number' ? p.service_port : 80,
                    },
                  },
                },
              })),
            },
          }));
        }

        // Update TLS if provided
        if (params.tls) {
          ingress.spec = ingress.spec || {};
          ingress.spec.tls = params.tls.map(t => ({
            hosts: t.hosts,
            secretName: t.secret_name,
          }));
        }

        await networkingApi.replaceNamespacedIngress(params.ingress_name, namespace, ingress);
        return `Ingress ${namespace}/${params.ingress_name} updated successfully.`;
      }

      case "add_annotation": {
        if (!params.ingress_name) {
          throw new Error("ingress_name is required for add_annotation action");
        }
        if (!params.annotation) {
          throw new Error("annotation is required for add_annotation action");
        }
        if (params.value === undefined) {
          throw new Error("value is required for add_annotation action");
        }

        const current = await networkingApi.readNamespacedIngress(params.ingress_name, namespace);
        const ingress = current.body as any;
        
        ingress.metadata = ingress.metadata || {};
        ingress.metadata.annotations = ingress.metadata.annotations || {};
        ingress.metadata.annotations[params.annotation] = params.value;

        await networkingApi.replaceNamespacedIngress(params.ingress_name, namespace, ingress);
        return `Annotation ${params.annotation}=${params.value} added to ${namespace}/${params.ingress_name}.`;
      }

      case "delete": {
        if (!params.ingress_name) {
          throw new Error("ingress_name is required for delete action");
        }
        await networkingApi.deleteNamespacedIngress(params.ingress_name, namespace);
        return `Ingress ${namespace}/${params.ingress_name} deleted successfully.`;
      }

      case "health": {
        if (!params.ingress_name) {
          throw new Error("ingress_name is required for health action");
        }
        const response = await networkingApi.readNamespacedIngress(params.ingress_name, namespace);
        const ingress = response.body as any;
        
        const lb = ingress.status?.loadBalancer?.ingress?.[0];
        let result = `Ingress Health: ${namespace}/${params.ingress_name}\n\n`;
        
        if (lb?.ip || lb?.hostname) {
          result += `✓ Load Balancer assigned\n`;
          result += `  IP: ${lb.ip || "N/A"}\n`;
          result += `  Hostname: ${lb.hostname || "N/A"}\n`;
          
          // Check TLS
          if (ingress.spec?.tls && ingress.spec.tls.length > 0) {
            result += `\n✓ TLS configured\n`;
          } else {
            result += `\n⚠ No TLS configured\n`;
          }
          
          // Check rules
          if (ingress.spec?.rules && ingress.spec.rules.length > 0) {
            result += `\n✓ Rules configured: ${ingress.spec.rules.length} host(s)\n`;
          } else {
            result += `\n⚠ No rules configured\n`;
          }
        } else {
          result += `⚠ No load balancer assigned yet\n`;
          result += `This may take a few minutes for the ingress controller to provision.`;
        }
        
        return result;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `ingress ${params.action}`));
  }
}

// Export for registration
export function registerK8sIngressTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_ingress",
    description: "Kubernetes Ingress operations: list, describe, rules, TLS, annotations, update, delete",
    schema: K8sIngressSchema,
    handler: async (params: K8sIngressParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sIngress(params, pluginConfig);
    },
  });
}

export { K8sIngressSchema, handleK8sIngress };