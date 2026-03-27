import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatAge, formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";

export const K8sPdbSchema = z.object({
  action: z.enum(["list", "describe", "status", "create", "delete", "check"]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  pdb_name: z.string().optional(),
  target_selector: z.string().optional(),
  min_available: z.union([z.number(), z.string()]).optional(),
  max_unavailable: z.union([z.number(), z.string()]).optional(),
  workload_name: z.string().optional(),
  label_selector: z.string().optional(),
  context: z.string().optional(),
});

type K8sPdbParams = z.infer<typeof K8sPdbSchema>;

function formatPdbList(pdbs: k8s.V1PodDisruptionBudget[]): string {
  if (pdbs.length === 0) {
    return "No PodDisruptionBudgets found.";
  }

  const headers = ["NAMESPACE", "NAME", "MIN-AVAILABLE", "MAX-UNAVAILABLE", "ALLOWED-DISRUPTIONS", "AGE"];
  const rows = pdbs.map((pdb) => {
    const namespace = pdb.metadata?.namespace || "unknown";
    const name = pdb.metadata?.name || "unknown";
    const minAvailable = pdb.spec?.minAvailable !== undefined ? String(pdb.spec.minAvailable) : "—";
    const maxUnavailable = pdb.spec?.maxUnavailable !== undefined ? String(pdb.spec.maxUnavailable) : "—";
    const allowed = pdb.status?.disruptionsAllowed !== undefined ? String(pdb.status.disruptionsAllowed) : "—";
    const creationTime = pdb.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";
    return [namespace, name, minAvailable, maxUnavailable, allowed, age];
  });

  return formatTable(headers, rows);
}

function formatPdbDescribe(pdb: k8s.V1PodDisruptionBudget): string {
  const name = pdb.metadata?.name || "unknown";
  const namespace = pdb.metadata?.namespace || "unknown";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `CreationTimestamp: ${pdb.metadata?.creationTimestamp || "unknown"}\n`;

  result += `\n--- Spec ---\n`;
  if (pdb.spec?.minAvailable !== undefined) {
    result += `  MinAvailable: ${pdb.spec.minAvailable}\n`;
  }
  if (pdb.spec?.maxUnavailable !== undefined) {
    result += `  MaxUnavailable: ${pdb.spec.maxUnavailable}\n`;
  }
  const selector = pdb.spec?.selector?.matchLabels;
  if (selector) {
    const labels = Object.entries(selector).map(([k, v]) => `${k}=${v}`).join(", ");
    result += `  Selector: ${labels}\n`;
  }

  result += `\n--- Status ---\n`;
  result += `  CurrentHealthy: ${pdb.status?.currentHealthy ?? "—"}\n`;
  result += `  DesiredHealthy: ${pdb.status?.desiredHealthy ?? "—"}\n`;
  result += `  DisruptionsAllowed: ${pdb.status?.disruptionsAllowed ?? "—"}\n`;
  result += `  ExpectedPods: ${pdb.status?.expectedPods ?? "—"}\n`;

  const conditions = pdb.status?.conditions || [];
  if (conditions.length > 0) {
    result += `\n--- Conditions ---\n`;
    conditions.forEach((c) => {
      result += `  ${c.type}: ${c.status} (${c.reason || ""})\n`;
    });
  }

  return result;
}

function formatPdbStatus(pdb: k8s.V1PodDisruptionBudget): string {
  const name = pdb.metadata?.name || "unknown";
  const namespace = pdb.metadata?.namespace || "unknown";

  let result = `PDB: ${namespace}/${name}\n`;
  result += `CurrentHealthy: ${pdb.status?.currentHealthy ?? 0}\n`;
  result += `DesiredHealthy: ${pdb.status?.desiredHealthy ?? 0}\n`;
  result += `DisruptionsAllowed: ${pdb.status?.disruptionsAllowed ?? 0}\n`;
  result += `ExpectedPods: ${pdb.status?.expectedPods ?? 0}\n`;

  const allowed = pdb.status?.disruptionsAllowed ?? 0;
  if (allowed > 0) {
    result += `\nProtection: ${allowed} disruption(s) allowed`;
  } else {
    result += `\nProtection: NO disruptions allowed (at minimum availability)`;
  }

  return result;
}

function formatPdbCheck(
  workloadName: string,
  matchingPdbs: k8s.V1PodDisruptionBudget[]
): string {
  const headers = ["WORKLOAD", "HAS-PDB", "PDB-NAME", "PROTECTION-LEVEL"];

  if (matchingPdbs.length === 0) {
    const rows = [[workloadName, "No", "—", "UNPROTECTED"]];
    return formatTable(headers, rows);
  }

  const rows = matchingPdbs.map((pdb) => {
    const pdbName = pdb.metadata?.name || "unknown";
    const minAvail = pdb.spec?.minAvailable;
    const maxUnavail = pdb.spec?.maxUnavailable;
    let protection = "—";
    if (minAvail !== undefined) {
      protection = `minAvailable=${minAvail}`;
    } else if (maxUnavail !== undefined) {
      protection = `maxUnavailable=${maxUnavail}`;
    }
    return [workloadName, "Yes", pdbName, protection];
  });

  return formatTable(headers, rows);
}

function parseSelector(selectorStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = selectorStr.split(",");
  for (const pair of pairs) {
    const [key, value] = pair.trim().split("=");
    if (key && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function selectorMatches(
  pdbSelector: Record<string, string>,
  workloadSelector: Record<string, string>
): boolean {
  for (const [key, value] of Object.entries(pdbSelector)) {
    if (workloadSelector[key] !== value) {
      return false;
    }
  }
  return true;
}

export async function handleK8sPdb(
  params: K8sPdbParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const clients = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let pdbs: k8s.V1PodDisruptionBudget[];

        if (params.all_namespaces) {
          const response = await clients.policyApi.listPodDisruptionBudgetForAllNamespaces(
            undefined, undefined, undefined, params.label_selector
          );
          pdbs = (response.body as any).items;
        } else {
          const response = await clients.policyApi.listNamespacedPodDisruptionBudget(
            namespace, undefined, undefined, undefined, undefined, params.label_selector
          );
          pdbs = (response.body as any).items;
        }

        return formatPdbList(pdbs);
      }

      case "describe": {
        if (!params.pdb_name) {
          throw new Error("pdb_name is required for describe action");
        }

        const response = await clients.policyApi.readNamespacedPodDisruptionBudget(
          params.pdb_name, namespace
        );

        return formatPdbDescribe(response.body as any);
      }

      case "status": {
        if (!params.pdb_name) {
          throw new Error("pdb_name is required for status action");
        }

        const response = await clients.policyApi.readNamespacedPodDisruptionBudget(
          params.pdb_name, namespace
        );

        return formatPdbStatus(response.body as any);
      }

      case "create": {
        if (!params.pdb_name) {
          throw new Error("pdb_name is required for create action");
        }
        if (!params.target_selector) {
          throw new Error("target_selector is required for create action");
        }
        if (params.min_available === undefined && params.max_unavailable === undefined) {
          throw new Error("Either min_available or max_unavailable is required for create action");
        }

        const matchLabels = parseSelector(params.target_selector);

        const pdb: k8s.V1PodDisruptionBudget = {
          apiVersion: "policy/v1",
          kind: "PodDisruptionBudget",
          metadata: {
            name: params.pdb_name,
            namespace,
          },
          spec: {
            selector: { matchLabels },
            ...(params.min_available !== undefined ? { minAvailable: params.min_available } : {}),
            ...(params.max_unavailable !== undefined ? { maxUnavailable: params.max_unavailable } : {}),
          },
        };

        await clients.policyApi.createNamespacedPodDisruptionBudget(namespace, pdb as any);

        return `PDB ${namespace}/${params.pdb_name} created with selector ${params.target_selector}`;
      }

      case "delete": {
        if (!params.pdb_name) {
          throw new Error("pdb_name is required for delete action");
        }

        await clients.policyApi.deleteNamespacedPodDisruptionBudget(
          params.pdb_name, namespace
        );

        return `PDB ${namespace}/${params.pdb_name} deleted`;
      }

      case "check": {
        if (!params.workload_name) {
          throw new Error("workload_name is required for check action");
        }

        const parts = params.workload_name.split("/");
        if (parts.length !== 2) {
          throw new Error(`Invalid workload_name format: "${params.workload_name}". Expected "Kind/name"`);
        }
        const [kind, name] = parts;

        let workloadSelector: Record<string, string> = {};

        if (kind === "Deployment") {
          const dep = await clients.appsApi.readNamespacedDeployment(name, namespace);
          workloadSelector = dep.body.spec?.selector?.matchLabels || {};
        } else if (kind === "StatefulSet") {
          const ss = await clients.appsApi.readNamespacedStatefulSet(name, namespace);
          workloadSelector = ss.body.spec?.selector?.matchLabels || {};
        } else if (kind === "DaemonSet") {
          const ds = await clients.appsApi.readNamespacedDaemonSet(name, namespace);
          workloadSelector = ds.body.spec?.selector?.matchLabels || {};
        } else {
          throw new Error(`Unsupported workload kind: ${kind}. Supported: Deployment, StatefulSet, DaemonSet`);
        }

        const pdbResponse = await clients.policyApi.listNamespacedPodDisruptionBudget(namespace);
        const allPdbs: k8s.V1PodDisruptionBudget[] = (pdbResponse.body as any).items;

        const matchingPdbs = allPdbs.filter((pdb) => {
          const pdbLabels = pdb.spec?.selector?.matchLabels || {};
          return selectorMatches(pdbLabels, workloadSelector);
        });

        return formatPdbCheck(params.workload_name, matchingPdbs);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `pdb ${params.action}`));
  }
}

export function registerK8sPdbTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_pdb",
    description:
      "Kubernetes PDB operations: list, describe, status, create, delete PodDisruptionBudgets, check workload protection",
    schema: K8sPdbSchema,
    handler: async (params: K8sPdbParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sPdb(params, pluginConfig);
    },
  });
}
