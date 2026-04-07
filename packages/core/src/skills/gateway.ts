import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { wrapK8sError } from "../lib/errors.js";
import { formatAge, formatTable, statusSymbol } from "../lib/format.js";
import type { PluginConfig } from "../lib/types.js";

const GATEWAY_GROUP = "gateway.networking.k8s.io";
const GATEWAY_VERSION = "v1";

const ROUTE_PLURALS: Record<string, string> = {
  HTTPRoute: "httproutes",
  GRPCRoute: "grpcroutes",
  TCPRoute: "tcproutes",
  TLSRoute: "tlsroutes",
};

export const K8sGatewaySchema = z.object({
  action: z.enum([
    "list_gateways",
    "describe_gateway",
    "list_routes",
    "describe_route",
    "list_classes",
    "status",
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  name: z.string().optional(),
  route_type: z
    .enum(["HTTPRoute", "GRPCRoute", "TCPRoute", "TLSRoute"])
    .optional(),
  label_selector: z.string().optional(),
  context: z.string().optional(),
});

export type K8sGatewayParams = z.infer<typeof K8sGatewaySchema>;

interface GatewayItem {
  metadata: { name: string; namespace: string; creationTimestamp: string };
  spec: {
    gatewayClassName: string;
    listeners: Array<{
      name: string;
      port: number;
      protocol: string;
      tls?: { certificateRefs?: Array<{ name: string; kind?: string }> };
      allowedRoutes?: { namespaces?: { from?: string } };
    }>;
  };
  status?: {
    addresses?: Array<{ value: string }>;
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
    listeners?: Array<{
      name: string;
      attachedRoutes: number;
      conditions?: Array<{ type: string; status: string; reason?: string }>;
    }>;
  };
}

interface RouteItem {
  metadata: { name: string; namespace: string; creationTimestamp: string };
  spec: {
    parentRefs?: Array<{ name: string; namespace?: string; sectionName?: string }>;
    hostnames?: string[];
    rules?: Array<{
      matches?: Array<{ path?: { type?: string; value?: string }; headers?: Array<{ name: string; value: string }> }>;
      backendRefs?: Array<{ name: string; port?: number; weight?: number }>;
      filters?: Array<{ type: string }>;
    }>;
  };
  status?: {
    parents?: Array<{
      parentRef: { name: string };
      conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
    }>;
  };
}

interface GatewayClassItem {
  metadata: { name: string; creationTimestamp: string };
  spec: { controllerName: string; description?: string };
  status?: {
    conditions?: Array<{ type: string; status: string; reason?: string }>;
  };
}

interface CustomObjectList {
  items: Array<Record<string, unknown>>;
}

function isGatewayApiNotInstalled(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    (error as { response?: { statusCode?: number } }).response?.statusCode === 404
  ) {
    return true;
  }
  if (error instanceof Error && error.message.includes("the server could not find the requested resource")) {
    return true;
  }
  return false;
}

function formatGatewayList(items: GatewayItem[]): string {
  if (items.length === 0) return "No Gateways found.";

  const headers = ["NAMESPACE", "NAME", "CLASS", "ADDRESSES", "LISTENERS", "AGE"];
  const rows = items.map((gw) => {
    const addresses = gw.status?.addresses?.map((a) => a.value).join(",") || "—";
    const listenerCount = String(gw.spec.listeners?.length || 0);
    const age = formatAge(new Date(gw.metadata.creationTimestamp));
    return [gw.metadata.namespace, gw.metadata.name, gw.spec.gatewayClassName, addresses, listenerCount, age];
  });

  return formatTable(headers, rows);
}

function formatGatewayDescribe(gw: GatewayItem): string {
  const lines: string[] = [];
  lines.push(`Gateway: ${gw.metadata.namespace}/${gw.metadata.name}`);
  lines.push(`Class: ${gw.spec.gatewayClassName}`);

  const addresses = gw.status?.addresses?.map((a) => a.value).join(", ") || "—";
  lines.push(`Addresses: ${addresses}`);

  if (gw.status?.conditions) {
    lines.push("");
    lines.push("Conditions:");
    for (const c of gw.status.conditions) {
      lines.push(`  ${statusSymbol(c.status)} ${c.type}: ${c.status} (${c.reason || "—"})`);
      if (c.message) lines.push(`    ${c.message}`);
    }
  }

  if (gw.spec.listeners && gw.spec.listeners.length > 0) {
    lines.push("");
    lines.push("Listeners:");
    for (let i = 0; i < gw.spec.listeners.length; i++) {
      const l = gw.spec.listeners[i];
      lines.push(`  [${i + 1}] ${l.name} (port ${l.port}, ${l.protocol})`);

      if (l.tls?.certificateRefs) {
        const refs = l.tls.certificateRefs.map((r) => `${r.kind || "Secret"}/${r.name}`).join(", ");
        lines.push(`      TLS: ${refs}`);
      }

      const allowed = l.allowedRoutes?.namespaces?.from || "Same";
      lines.push(`      Allowed Routes: ${allowed} namespace`);

      const listenerStatus = gw.status?.listeners?.find((ls) => ls.name === l.name);
      if (listenerStatus) {
        lines.push(`      Attached Routes: ${listenerStatus.attachedRoutes}`);
      }
    }
  }

  return lines.join("\n");
}

function formatRouteList(items: RouteItem[], routeType: string): string {
  if (items.length === 0) return `No ${routeType}s found.`;

  const headers = ["NAMESPACE", "NAME", "HOSTNAMES", "PARENT-REFS", "AGE"];
  const rows = items.map((route) => {
    const hostnames = route.spec.hostnames?.join(",") || "*";
    const parents = route.spec.parentRefs?.map((p) => p.name).join(",") || "—";
    const age = formatAge(new Date(route.metadata.creationTimestamp));
    return [route.metadata.namespace, route.metadata.name, hostnames, parents, age];
  });

  return formatTable(headers, rows);
}

function formatRouteDescribe(route: RouteItem, routeType: string): string {
  const lines: string[] = [];
  lines.push(`${routeType}: ${route.metadata.namespace}/${route.metadata.name}`);

  if (route.spec.hostnames) {
    lines.push(`Hostnames: ${route.spec.hostnames.join(", ")}`);
  }

  if (route.spec.parentRefs) {
    lines.push("");
    lines.push("Parent Refs:");
    for (const p of route.spec.parentRefs) {
      const ns = p.namespace ? `${p.namespace}/` : "";
      const section = p.sectionName ? ` (section: ${p.sectionName})` : "";
      lines.push(`  - ${ns}${p.name}${section}`);
    }
  }

  if (route.spec.rules && route.spec.rules.length > 0) {
    lines.push("");
    lines.push("Rules:");
    for (let i = 0; i < route.spec.rules.length; i++) {
      const rule = route.spec.rules[i];
      lines.push(`  [${i + 1}]`);

      if (rule.matches) {
        for (const m of rule.matches) {
          if (m.path) {
            lines.push(`    Match: ${m.path.type || "PathPrefix"} ${m.path.value || "/"}`);
          }
          if (m.headers) {
            for (const h of m.headers) {
              lines.push(`    Header: ${h.name}=${h.value}`);
            }
          }
        }
      }

      if (rule.backendRefs) {
        lines.push("    Backends:");
        for (const b of rule.backendRefs) {
          const weight = b.weight !== undefined ? ` (weight: ${b.weight})` : "";
          lines.push(`      - ${b.name}:${b.port || "—"}${weight}`);
        }
      }

      if (rule.filters) {
        lines.push(`    Filters: ${rule.filters.map((f) => f.type).join(", ")}`);
      }
    }
  }

  if (route.status?.parents) {
    lines.push("");
    lines.push("Status:");
    for (const p of route.status.parents) {
      lines.push(`  Parent: ${p.parentRef.name}`);
      if (p.conditions) {
        for (const c of p.conditions) {
          lines.push(`    ${statusSymbol(c.status)} ${c.type}: ${c.status} (${c.reason || "—"})`);
        }
      }
    }
  }

  return lines.join("\n");
}

function formatGatewayClassList(items: GatewayClassItem[]): string {
  if (items.length === 0) return "No GatewayClasses found.";

  const headers = ["NAME", "CONTROLLER", "ACCEPTED", "DESCRIPTION", "AGE"];
  const rows = items.map((gc) => {
    const accepted = gc.status?.conditions?.find((c) => c.type === "Accepted");
    const acceptedStr = accepted ? `${statusSymbol(accepted.status)} ${accepted.status}` : "—";
    const age = formatAge(new Date(gc.metadata.creationTimestamp));
    return [gc.metadata.name, gc.spec.controllerName, acceptedStr, gc.spec.description || "—", age];
  });

  return formatTable(headers, rows);
}

function formatGatewayStatus(gateways: GatewayItem[], routes: RouteItem[]): string {
  const lines: string[] = [];
  lines.push("=== Gateway API Status ===");
  lines.push("");

  if (gateways.length === 0) {
    lines.push("No Gateways found.");
    return lines.join("\n");
  }

  lines.push(`Gateways: ${gateways.length}`);
  for (const gw of gateways) {
    const accepted = gw.status?.conditions?.find((c) => c.type === "Accepted");
    const programmed = gw.status?.conditions?.find((c) => c.type === "Programmed");
    const acceptedSym = accepted ? statusSymbol(accepted.status) : "?";
    const programmedSym = programmed ? statusSymbol(programmed.status) : "?";
    lines.push(`  ${acceptedSym} ${gw.metadata.namespace}/${gw.metadata.name} [Accepted: ${accepted?.status || "—"}, Programmed: ${programmed?.status || "—"}]`);
  }

  lines.push("");
  lines.push(`Routes: ${routes.length}`);
  for (const route of routes) {
    const parentStatuses = route.status?.parents || [];
    const allAccepted = parentStatuses.every((p) =>
      p.conditions?.some((c) => c.type === "Accepted" && c.status === "True")
    );
    const sym = parentStatuses.length > 0 ? statusSymbol(allAccepted ? "True" : "False") : "?";
    lines.push(`  ${sym} ${route.metadata.namespace}/${route.metadata.name} (${route.spec.hostnames?.join(",") || "*"})`);
  }

  return lines.join("\n");
}

export async function handleK8sGateway(
  params: K8sGatewayParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const { customObjectsApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list_gateways": {
        try {
          const response = params.all_namespaces
            ? await customObjectsApi.listClusterCustomObject(
                GATEWAY_GROUP, GATEWAY_VERSION, "gateways",
                undefined, undefined, undefined, undefined, params.label_selector
              )
            : await customObjectsApi.listNamespacedCustomObject(
                GATEWAY_GROUP, GATEWAY_VERSION, namespace, "gateways",
                undefined, undefined, undefined, undefined, params.label_selector
              );
          const list = response.body as CustomObjectList;
          return formatGatewayList(list.items as unknown as GatewayItem[]);
        } catch (error: unknown) {
          if (isGatewayApiNotInstalled(error)) {
            return "Gateway API is not installed in this cluster. Install from: https://gateway-api.sigs.k8s.io/guides/#installing-gateway-api";
          }
          throw error;
        }
      }

      case "describe_gateway": {
        if (!params.name) throw new Error("name is required for describe_gateway action");
        try {
          const response = await customObjectsApi.getNamespacedCustomObject(
            GATEWAY_GROUP, GATEWAY_VERSION, namespace, "gateways", params.name
          );
          return formatGatewayDescribe(response.body as unknown as GatewayItem);
        } catch (error: unknown) {
          if (isGatewayApiNotInstalled(error)) {
            return "Gateway API is not installed in this cluster. Install from: https://gateway-api.sigs.k8s.io/guides/#installing-gateway-api";
          }
          throw error;
        }
      }

      case "list_routes": {
        const routeType = params.route_type || "HTTPRoute";
        const plural = ROUTE_PLURALS[routeType];
        if (!plural) throw new Error(`Unknown route type: ${routeType}`);

        try {
          const response = params.all_namespaces
            ? await customObjectsApi.listClusterCustomObject(
                GATEWAY_GROUP, GATEWAY_VERSION, plural,
                undefined, undefined, undefined, undefined, params.label_selector
              )
            : await customObjectsApi.listNamespacedCustomObject(
                GATEWAY_GROUP, GATEWAY_VERSION, namespace, plural,
                undefined, undefined, undefined, undefined, params.label_selector
              );
          const list = response.body as CustomObjectList;
          return formatRouteList(list.items as unknown as RouteItem[], routeType);
        } catch (error: unknown) {
          if (isGatewayApiNotInstalled(error)) {
            return "Gateway API is not installed in this cluster. Install from: https://gateway-api.sigs.k8s.io/guides/#installing-gateway-api";
          }
          throw error;
        }
      }

      case "describe_route": {
        if (!params.name) throw new Error("name is required for describe_route action");
        const routeType = params.route_type || "HTTPRoute";
        const plural = ROUTE_PLURALS[routeType];
        if (!plural) throw new Error(`Unknown route type: ${routeType}`);

        try {
          const response = await customObjectsApi.getNamespacedCustomObject(
            GATEWAY_GROUP, GATEWAY_VERSION, namespace, plural, params.name
          );
          return formatRouteDescribe(response.body as unknown as RouteItem, routeType);
        } catch (error: unknown) {
          if (isGatewayApiNotInstalled(error)) {
            return "Gateway API is not installed in this cluster. Install from: https://gateway-api.sigs.k8s.io/guides/#installing-gateway-api";
          }
          throw error;
        }
      }

      case "list_classes": {
        try {
          const response = await customObjectsApi.listClusterCustomObject(
            GATEWAY_GROUP, GATEWAY_VERSION, "gatewayclasses"
          );
          const list = response.body as CustomObjectList;
          return formatGatewayClassList(list.items as unknown as GatewayClassItem[]);
        } catch (error: unknown) {
          if (isGatewayApiNotInstalled(error)) {
            return "Gateway API is not installed in this cluster. Install from: https://gateway-api.sigs.k8s.io/guides/#installing-gateway-api";
          }
          throw error;
        }
      }

      case "status": {
        try {
          const gwResponse = params.all_namespaces
            ? await customObjectsApi.listClusterCustomObject(GATEWAY_GROUP, GATEWAY_VERSION, "gateways")
            : await customObjectsApi.listNamespacedCustomObject(GATEWAY_GROUP, GATEWAY_VERSION, namespace, "gateways");
          const gateways = (gwResponse.body as CustomObjectList).items as unknown as GatewayItem[];

          const rtResponse = params.all_namespaces
            ? await customObjectsApi.listClusterCustomObject(GATEWAY_GROUP, GATEWAY_VERSION, "httproutes")
            : await customObjectsApi.listNamespacedCustomObject(GATEWAY_GROUP, GATEWAY_VERSION, namespace, "httproutes");
          const routes = (rtResponse.body as CustomObjectList).items as unknown as RouteItem[];

          return formatGatewayStatus(gateways, routes);
        } catch (error: unknown) {
          if (isGatewayApiNotInstalled(error)) {
            return "Gateway API is not installed in this cluster. Install from: https://gateway-api.sigs.k8s.io/guides/#installing-gateway-api";
          }
          throw error;
        }
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `gateway ${params.action}`));
  }
}

