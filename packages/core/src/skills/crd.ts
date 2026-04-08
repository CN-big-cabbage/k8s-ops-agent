import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { formatAge, formatTable } from "../lib/format.js";
import { wrapK8sError } from "../lib/errors.js";
import type { PluginConfig } from "../lib/types.js";

export const K8sCrdSchema = z.object({
  action: z.enum([
    "list_definitions",
    "describe_definition",
    "list_resources",
    "describe_resource",
    "delete_resource",
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  crd_name: z.string().optional(),
  group: z.string().optional(),
  version: z.string().optional(),
  plural: z.string().optional(),
  resource_name: z.string().optional(),
  label_selector: z.string().optional(),
  context: z.string().optional(),
});

export type K8sCrdParams = z.infer<typeof K8sCrdSchema>;

interface CrdInfo {
  group: string;
  version: string;
  plural: string;
  scope: string;
}

function formatCrdList(crds: k8s.V1CustomResourceDefinition[]): string {
  if (crds.length === 0) {
    return "No CustomResourceDefinitions found.";
  }

  const headers = ["NAME", "GROUP", "VERSION", "SCOPE", "ESTABLISHED", "AGE"];
  const rows = crds.map((crd) => {
    const name = crd.metadata?.name || "unknown";
    const group = crd.spec?.group || "—";
    const versions = crd.spec?.versions || [];
    const storedVersion = versions.find((v) => v.storage)?.name || versions[0]?.name || "—";
    const scope = crd.spec?.scope || "—";
    const established = crd.status?.conditions?.find((c) => c.type === "Established");
    const estStatus = established?.status === "True" ? "True" : "False";
    const creationTime = crd.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";
    return [name, group, storedVersion, scope, estStatus, age];
  });

  return formatTable(headers, rows);
}

function simplifySchema(schema: Record<string, unknown>, depth: number, maxDepth: number): string {
  if (depth >= maxDepth) {
    return "...";
  }

  const type = schema.type as string | undefined;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;

  if (!properties) {
    return type || "unknown";
  }

  const lines: string[] = [];
  const indent = "  ".repeat(depth + 1);

  for (const [key, prop] of Object.entries(properties)) {
    const propType = prop.type as string || "object";
    if (propType === "object" && prop.properties) {
      lines.push(`${indent}${key}: {`);
      lines.push(simplifySchema(prop, depth + 1, maxDepth));
      lines.push(`${indent}}`);
    } else if (propType === "array") {
      const items = prop.items as Record<string, unknown> | undefined;
      const itemType = items?.type as string || "object";
      lines.push(`${indent}${key}: ${propType}<${itemType}>`);
    } else {
      const desc = prop.description as string | undefined;
      const suffix = desc ? ` // ${desc.slice(0, 60)}` : "";
      lines.push(`${indent}${key}: ${propType}${suffix}`);
    }
  }

  return lines.join("\n");
}

function formatCrdDescribe(crd: k8s.V1CustomResourceDefinition): string {
  const name = crd.metadata?.name || "unknown";

  let result = `Name: ${name}\n`;
  result += `Group: ${crd.spec?.group || "—"}\n`;
  result += `Scope: ${crd.spec?.scope || "—"}\n`;
  result += `CreationTimestamp: ${crd.metadata?.creationTimestamp || "unknown"}\n`;

  const versions = crd.spec?.versions || [];
  result += `\n--- Versions ---\n`;
  versions.forEach((v) => {
    const served = v.served ? "Served" : "Not Served";
    const storage = v.storage ? "Storage" : "";
    result += `  ${v.name}: ${served} ${storage}\n`;
  });

  const storedVersion = versions.find((v) => v.storage) || versions[0];
  const columns = storedVersion?.additionalPrinterColumns || [];
  if (columns.length > 0) {
    result += `\n--- Additional Printer Columns ---\n`;
    columns.forEach((col) => {
      result += `  ${col.name}: ${col.type} (${col.jsonPath})\n`;
    });
  }

  const openApiSchema = storedVersion?.schema?.openAPIV3Schema as Record<string, unknown> | undefined;
  if (openApiSchema) {
    result += `\n--- Schema (simplified, 3 levels) ---\n`;
    result += simplifySchema(openApiSchema, 0, 3);
    result += "\n";
  }

  const conditions = crd.status?.conditions || [];
  if (conditions.length > 0) {
    result += `\n--- Conditions ---\n`;
    conditions.forEach((c) => {
      result += `  ${c.type}: ${c.status} (${c.reason || ""})\n`;
    });
  }

  return result;
}

function formatCrList(
  items: Record<string, unknown>[],
  columns: k8s.V1CustomResourceColumnDefinition[]
): string {
  if (items.length === 0) {
    return "No custom resources found.";
  }

  const defaultHeaders = ["NAMESPACE", "NAME", "AGE"];
  const extraHeaders = columns.map((c) => c.name.toUpperCase());
  const headers = [...defaultHeaders, ...extraHeaders];

  const rows = items.map((item) => {
    const metadata = item.metadata as Record<string, unknown> | undefined;
    const namespace = (metadata?.namespace as string) || "—";
    const name = (metadata?.name as string) || "unknown";
    const creationTime = metadata?.creationTimestamp as string | undefined;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";

    const extraCols = columns.map((col) => {
      const value = resolveJsonPath(item, col.jsonPath);
      return value !== undefined ? String(value) : "—";
    });

    return [namespace, name, age, ...extraCols];
  });

  return formatTable(headers, rows);
}

function resolveJsonPath(obj: Record<string, unknown>, jsonPath: string): unknown {
  const path = jsonPath.replace(/^\./, "").split(".");
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function formatCrDescribe(item: Record<string, unknown>): string {
  const metadata = item.metadata as Record<string, unknown> | undefined;
  const name = (metadata?.name as string) || "unknown";
  const namespace = (metadata?.namespace as string) || "—";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `CreationTimestamp: ${metadata?.creationTimestamp || "unknown"}\n`;

  const labels = metadata?.labels as Record<string, string> | undefined;
  if (labels && Object.keys(labels).length > 0) {
    result += `Labels:\n`;
    for (const [k, v] of Object.entries(labels)) {
      result += `  ${k}: ${v}\n`;
    }
  }

  const spec = item.spec as Record<string, unknown> | undefined;
  if (spec) {
    result += `\n--- Spec ---\n`;
    result += yamlLike(spec, 1);
  }

  const status = item.status as Record<string, unknown> | undefined;
  if (status) {
    result += `\n--- Status ---\n`;
    result += yamlLike(status, 1);
  }

  return result;
}

function yamlLike(obj: Record<string, unknown>, depth: number): string {
  const indent = "  ".repeat(depth);
  let result = "";

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result += `${indent}${key}: null\n`;
    } else if (Array.isArray(value)) {
      result += `${indent}${key}:\n`;
      value.forEach((item) => {
        if (typeof item === "object" && item !== null) {
          result += `${indent}- \n`;
          result += yamlLike(item as Record<string, unknown>, depth + 2);
        } else {
          result += `${indent}- ${item}\n`;
        }
      });
    } else if (typeof value === "object") {
      result += `${indent}${key}:\n`;
      result += yamlLike(value as Record<string, unknown>, depth + 1);
    } else {
      result += `${indent}${key}: ${value}\n`;
    }
  }

  return result;
}

function extractCrdInfo(crd: k8s.V1CustomResourceDefinition): CrdInfo {
  const group = crd.spec?.group || "";
  const versions = crd.spec?.versions || [];
  const storedVersion = versions.find((v) => v.storage) || versions[0];
  const version = storedVersion?.name || "";
  const plural = crd.spec?.names?.plural || "";
  const scope = crd.spec?.scope || "Namespaced";
  return { group, version, plural, scope };
}

export async function handleK8sCrd(
  params: K8sCrdParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const clients = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list_definitions": {
        const response = await clients.apiextensionsApi.listCustomResourceDefinition(
          undefined, undefined, undefined, undefined, params.label_selector
        );
        return formatCrdList(response.body.items);
      }

      case "describe_definition": {
        if (!params.crd_name) {
          throw new Error("crd_name is required for describe_definition action");
        }

        const response = await clients.apiextensionsApi.readCustomResourceDefinition(
          params.crd_name
        );
        return formatCrdDescribe(response.body);
      }

      case "list_resources": {
        const { group, version, plural, scope } = await resolveCrdTriple(params, clients);

        let items: Record<string, unknown>[];
        let columns: k8s.V1CustomResourceColumnDefinition[] = [];

        if (params.crd_name) {
          const crdResp = await clients.apiextensionsApi.readCustomResourceDefinition(params.crd_name);
          const storedVersion = crdResp.body.spec?.versions?.find((v) => v.storage) || crdResp.body.spec?.versions?.[0];
          columns = storedVersion?.additionalPrinterColumns || [];
        }

        if (scope === "Cluster" || params.all_namespaces) {
          const response = await clients.customObjectsApi.listClusterCustomObject(
            group, version, plural,
            undefined, undefined, undefined, undefined, params.label_selector
          );
          items = ((response.body as any).items || []) as Record<string, unknown>[];
        } else {
          const response = await clients.customObjectsApi.listNamespacedCustomObject(
            group, version, namespace, plural,
            undefined, undefined, undefined, undefined, params.label_selector
          );
          items = ((response.body as any).items || []) as Record<string, unknown>[];
        }

        return formatCrList(items, columns);
      }

      case "describe_resource": {
        if (!params.resource_name) {
          throw new Error("resource_name is required for describe_resource action");
        }

        const { group, version, plural, scope } = await resolveCrdTriple(params, clients);

        let item: Record<string, unknown>;
        if (scope === "Cluster") {
          const response = await clients.customObjectsApi.getClusterCustomObject(
            group, version, plural, params.resource_name
          );
          item = response.body as Record<string, unknown>;
        } else {
          const response = await clients.customObjectsApi.getNamespacedCustomObject(
            group, version, namespace, plural, params.resource_name
          );
          item = response.body as Record<string, unknown>;
        }

        return formatCrDescribe(item);
      }

      case "delete_resource": {
        if (!params.resource_name) {
          throw new Error("resource_name is required for delete_resource action");
        }

        const { group, version, plural, scope } = await resolveCrdTriple(params, clients);

        if (scope === "Cluster") {
          await clients.customObjectsApi.deleteClusterCustomObject(
            group, version, plural, params.resource_name
          );
        } else {
          await clients.customObjectsApi.deleteNamespacedCustomObject(
            group, version, namespace, plural, params.resource_name
          );
        }

        return `Custom resource ${params.resource_name} deleted`;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `crd ${params.action}`));
  }
}

async function resolveCrdTriple(
  params: K8sCrdParams,
  clients: ReturnType<typeof createK8sClients>
): Promise<CrdInfo> {
  if (params.group && params.version && params.plural) {
    return {
      group: params.group,
      version: params.version,
      plural: params.plural,
      scope: "Namespaced",
    };
  }

  if (params.crd_name) {
    const crdResp = await clients.apiextensionsApi.readCustomResourceDefinition(params.crd_name);
    return extractCrdInfo(crdResp.body);
  }

  throw new Error("Either crd_name or group/version/plural are required");
}

