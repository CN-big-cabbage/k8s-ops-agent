import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatAge, formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";

export const K8sHpaSchema = z.object({
  action: z.enum(["list", "describe", "status", "create", "update", "delete"]),
  namespace: z.string().optional(),
  hpa_name: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  target_ref: z.string().optional(),
  min_replicas: z.number().int().min(1).optional(),
  max_replicas: z.number().int().min(1).optional(),
  cpu_target: z.number().int().min(1).max(100).optional(),
  context: z.string().optional(),
});

type K8sHpaParams = z.infer<typeof K8sHpaSchema>;

function formatHpaList(hpas: k8s.V2HorizontalPodAutoscaler[]): string {
  if (hpas.length === 0) {
    return "No HPAs found.";
  }

  const headers = ["NAMESPACE", "NAME", "REFERENCE", "MINPODS", "MAXPODS", "REPLICAS", "AGE"];
  const rows = hpas.map((hpa) => {
    const namespace = hpa.metadata?.namespace || "unknown";
    const name = hpa.metadata?.name || "unknown";
    const ref = hpa.spec?.scaleTargetRef
      ? `${hpa.spec.scaleTargetRef.kind}/${hpa.spec.scaleTargetRef.name}`
      : "—";
    const minPods = (hpa.spec?.minReplicas || 1).toString();
    const maxPods = (hpa.spec?.maxReplicas || 0).toString();
    const replicas = (hpa.status?.currentReplicas || 0).toString();
    const creationTime = hpa.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";
    return [namespace, name, ref, minPods, maxPods, replicas, age];
  });

  return formatTable(headers, rows);
}

function formatHpaDescribe(hpa: k8s.V2HorizontalPodAutoscaler): string {
  const name = hpa.metadata?.name || "unknown";
  const namespace = hpa.metadata?.namespace || "unknown";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `CreationTimestamp: ${hpa.metadata?.creationTimestamp || "unknown"}\n`;

  result += `\n--- Scale Target ---\n`;
  const ref = hpa.spec?.scaleTargetRef;
  if (ref) {
    result += `  Reference: ${ref.kind}/${ref.name}\n`;
  }
  result += `  MinReplicas: ${hpa.spec?.minReplicas || 1}\n`;
  result += `  MaxReplicas: ${hpa.spec?.maxReplicas || 0}\n`;

  result += `\n--- Current Replicas ---\n`;
  result += `  Current: ${hpa.status?.currentReplicas || 0}\n`;
  result += `  Desired: ${hpa.status?.desiredReplicas || 0}\n`;

  const metrics = hpa.spec?.metrics || [];
  if (metrics.length > 0) {
    result += `\n--- Metrics (Target) ---\n`;
    metrics.forEach((m) => {
      if (m.type === "Resource" && m.resource) {
        const targetUtil = m.resource.target?.averageUtilization;
        result += `  ${m.resource.name}: target ${targetUtil || "—"}%\n`;
      }
    });
  }

  const currentMetrics = hpa.status?.currentMetrics || [];
  if (currentMetrics.length > 0) {
    result += `\n--- Metrics (Current) ---\n`;
    currentMetrics.forEach((m) => {
      if (m.type === "Resource" && m.resource) {
        const currentUtil = m.resource.current?.averageUtilization;
        result += `  ${m.resource.name}: current ${currentUtil || "—"}%\n`;
      }
    });
  }

  const conditions = hpa.status?.conditions || [];
  if (conditions.length > 0) {
    result += `\n--- Conditions ---\n`;
    conditions.forEach((c) => {
      result += `  ${c.type}: ${c.status} (${c.reason || ""})\n`;
    });
  }

  return result;
}

function formatHpaStatus(hpa: k8s.V2HorizontalPodAutoscaler): string {
  const name = hpa.metadata?.name || "unknown";
  const namespace = hpa.metadata?.namespace || "unknown";
  const current = hpa.status?.currentReplicas || 0;
  const desired = hpa.status?.desiredReplicas || 0;
  const min = hpa.spec?.minReplicas || 1;
  const max = hpa.spec?.maxReplicas || 0;

  let result = `HPA: ${namespace}/${name}\n`;
  result += `Replicas: current=${current}, desired=${desired} (min=${min}, max=${max})\n`;

  const ref = hpa.spec?.scaleTargetRef;
  if (ref) {
    result += `Target: ${ref.kind}/${ref.name}\n`;
  }

  if (current === desired) {
    result += `\n✓ Stable at ${current} replicas`;
  } else if (desired > current) {
    result += `\n⟳ Scaling up: ${current} → ${desired}`;
  } else {
    result += `\n⟳ Scaling down: ${current} → ${desired}`;
  }

  return result;
}

function parseTargetRef(targetRef: string): { kind: string; name: string } {
  const parts = targetRef.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid target_ref format: "${targetRef}". Expected "Kind/name" (e.g. "Deployment/web")`);
  }
  return { kind: parts[0], name: parts[1] };
}

export async function handleK8sHpa(
  params: K8sHpaParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const { autoscalingApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let hpas: k8s.V2HorizontalPodAutoscaler[];

        if (params.all_namespaces) {
          const response = await autoscalingApi.listHorizontalPodAutoscalerForAllNamespaces(
            undefined, undefined, undefined, params.label_selector
          );
          hpas = response.body.items;
        } else {
          const response = await autoscalingApi.listNamespacedHorizontalPodAutoscaler(
            namespace, undefined, undefined, undefined, undefined, params.label_selector
          );
          hpas = response.body.items;
        }

        return formatHpaList(hpas);
      }

      case "describe": {
        if (!params.hpa_name) {
          throw new Error("hpa_name is required for describe action");
        }

        const response = await autoscalingApi.readNamespacedHorizontalPodAutoscaler(
          params.hpa_name, namespace
        );

        return formatHpaDescribe(response.body);
      }

      case "status": {
        if (!params.hpa_name) {
          throw new Error("hpa_name is required for status action");
        }

        const response = await autoscalingApi.readNamespacedHorizontalPodAutoscaler(
          params.hpa_name, namespace
        );

        return formatHpaStatus(response.body);
      }

      case "create": {
        if (!params.hpa_name) {
          throw new Error("hpa_name is required for create action");
        }
        if (!params.target_ref) {
          throw new Error("target_ref is required for create action");
        }

        const { kind, name } = parseTargetRef(params.target_ref);

        const hpa: k8s.V2HorizontalPodAutoscaler = {
          apiVersion: "autoscaling/v2",
          kind: "HorizontalPodAutoscaler",
          metadata: {
            name: params.hpa_name,
            namespace,
          },
          spec: {
            scaleTargetRef: {
              apiVersion: "apps/v1",
              kind,
              name,
            },
            minReplicas: params.min_replicas || 1,
            maxReplicas: params.max_replicas || 10,
            metrics: params.cpu_target
              ? [
                  {
                    type: "Resource",
                    resource: {
                      name: "cpu",
                      target: {
                        type: "Utilization",
                        averageUtilization: params.cpu_target,
                      },
                    },
                  },
                ]
              : undefined,
          },
        };

        await autoscalingApi.createNamespacedHorizontalPodAutoscaler(namespace, hpa);

        return `HPA ${namespace}/${params.hpa_name} created targeting ${params.target_ref}`;
      }

      case "update": {
        if (!params.hpa_name) {
          throw new Error("hpa_name is required for update action");
        }

        const patch: Record<string, unknown> = {};
        const specPatch: Record<string, unknown> = {};

        if (params.min_replicas !== undefined) {
          specPatch.minReplicas = params.min_replicas;
        }
        if (params.max_replicas !== undefined) {
          specPatch.maxReplicas = params.max_replicas;
        }
        if (params.cpu_target !== undefined) {
          specPatch.metrics = [
            {
              type: "Resource",
              resource: {
                name: "cpu",
                target: {
                  type: "Utilization",
                  averageUtilization: params.cpu_target,
                },
              },
            },
          ];
        }

        if (Object.keys(specPatch).length > 0) {
          patch.spec = specPatch;
        }

        await autoscalingApi.patchNamespacedHorizontalPodAutoscaler(
          params.hpa_name, namespace, patch,
          undefined, undefined, undefined, undefined,
          { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
        );

        return `HPA ${namespace}/${params.hpa_name} updated`;
      }

      case "delete": {
        if (!params.hpa_name) {
          throw new Error("hpa_name is required for delete action");
        }

        await autoscalingApi.deleteNamespacedHorizontalPodAutoscaler(
          params.hpa_name, namespace
        );

        return `HPA ${namespace}/${params.hpa_name} deleted`;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `hpa ${params.action}`));
  }
}

export function registerK8sHpaTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_hpa",
    description:
      "Kubernetes HPA operations: list, describe, status, create, update, delete horizontal pod autoscalers",
    schema: K8sHpaSchema,
    handler: async (params: K8sHpaParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sHpa(params, pluginConfig);
    },
  });
}
