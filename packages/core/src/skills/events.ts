import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { formatTable, formatAge, truncateOutput } from "../lib/format.js";
import { wrapK8sError } from "../lib/errors.js";
import type { PluginConfig } from "../lib/types.js";
import { DEFAULT_NAMESPACE, MAX_OUTPUT_BYTES } from "../lib/types.js";

// --- Schema ---

export const K8sEventsSchema = z.object({
  action: z.enum(["list", "filter", "recent", "export"]),
  namespace: z.string().default(DEFAULT_NAMESPACE),
  all_namespaces: z.boolean().default(false),
  resource_kind: z.string().optional(),
  resource_name: z.string().optional(),
  event_type: z.enum(["Normal", "Warning"]).optional(),
  reason: z.string().optional(),
  since_minutes: z.number().int().positive().default(60),
  format: z.enum(["json", "table"]).default("table"),
  limit: z.number().int().positive().default(50),
  context: z.string().optional(),
});

type K8sEventsParams = z.infer<typeof K8sEventsSchema>;

// --- Pure functions (exported for testing) ---

export function getEventTimestamp(event: k8s.CoreV1Event): Date {
  if (event.lastTimestamp) return new Date(event.lastTimestamp as unknown as string);
  if (event.eventTime) return new Date(event.eventTime as unknown as string);
  return new Date(event.metadata!.creationTimestamp as unknown as string);
}

interface FilterCriteria {
  event_type?: string;
  reason?: string;
  resource_kind?: string;
  resource_name?: string;
}

export function filterEvents(events: k8s.CoreV1Event[], criteria: FilterCriteria): k8s.CoreV1Event[] {
  return events.filter((e) => {
    if (criteria.event_type && e.type !== criteria.event_type) return false;
    if (criteria.reason && e.reason !== criteria.reason) return false;
    if (criteria.resource_kind && e.involvedObject?.kind !== criteria.resource_kind) return false;
    if (criteria.resource_name && e.involvedObject?.name !== criteria.resource_name) return false;
    return true;
  });
}

export function formatEventRow(event: k8s.CoreV1Event): string[] {
  const ts = getEventTimestamp(event);
  const age = formatAge(ts);
  const obj = `${event.involvedObject?.kind || "?"}/${event.involvedObject?.name || "?"}`;
  const message = (event.message || "").slice(0, 80);
  return [age, event.type || "?", event.reason || "?", obj, message];
}

function formatEventsTable(events: k8s.CoreV1Event[]): string {
  const headers = ["TIME", "TYPE", "REASON", "OBJECT", "MESSAGE"];
  const rows = events.map(formatEventRow);
  return formatTable(headers, rows);
}

function formatEventsJson(events: k8s.CoreV1Event[]): string {
  const data = events.map((e) => ({
    timestamp: getEventTimestamp(e).toISOString(),
    type: e.type,
    reason: e.reason,
    object: `${e.involvedObject?.kind}/${e.involvedObject?.name}`,
    message: e.message,
    count: e.count || 1,
    namespace: e.metadata?.namespace,
  }));
  return JSON.stringify(data, null, 2);
}

// --- Fetch events ---

async function fetchEvents(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  allNamespaces: boolean
): Promise<k8s.CoreV1Event[]> {
  const response = allNamespaces
    ? await coreApi.listEventForAllNamespaces()
    : await coreApi.listNamespacedEvent(namespace);
  const events = response.body.items || [];
  events.sort((a, b) => getEventTimestamp(b).getTime() - getEventTimestamp(a).getTime());
  return events;
}

// --- Handler ---

export async function handleK8sEvents(params: K8sEventsParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi } = createK8sClients(pluginConfig, params.context);
    const allEvents = await fetchEvents(coreApi, params.namespace, params.all_namespaces);
    const nsLabel = params.all_namespaces ? "all namespaces" : `namespace: ${params.namespace}`;

    switch (params.action) {
      case "list": {
        const limited = allEvents.slice(0, params.limit);
        const normal = limited.filter((e) => e.type === "Normal").length;
        const warning = limited.filter((e) => e.type === "Warning").length;
        let result = `Events in ${nsLabel} (last ${limited.length})\n\n`;
        result += formatEventsTable(limited);
        result += `\n\nTotal: ${limited.length} events (${normal} Normal, ${warning} Warning)`;
        return truncateOutput(result, MAX_OUTPUT_BYTES);
      }

      case "filter": {
        const { resource_kind, resource_name, event_type, reason } = params;
        if (!resource_kind && !resource_name && !event_type && !reason) {
          return "Error: At least one filter parameter is required (resource_kind, resource_name, event_type, reason). Use 'list' for unfiltered results.";
        }
        const filtered = filterEvents(allEvents, { resource_kind, resource_name, event_type, reason });
        const limited = filtered.slice(0, params.limit);
        let result = `Filtered events in ${nsLabel} (${limited.length} matches)\n\n`;
        if (limited.length === 0) {
          result += "No events match the specified criteria.";
        } else {
          result += formatEventsTable(limited);
        }
        return truncateOutput(result, MAX_OUTPUT_BYTES);
      }

      case "recent": {
        const cutoff = new Date(Date.now() - params.since_minutes * 60 * 1000);
        const recent = allEvents.filter((e) => getEventTimestamp(e) >= cutoff);
        const limited = recent.slice(0, params.limit);
        const normal = limited.filter((e) => e.type === "Normal").length;
        const warning = limited.filter((e) => e.type === "Warning").length;
        let result = `Events in ${nsLabel} (last ${params.since_minutes}min)\n\n`;
        if (limited.length === 0) {
          result += "No events in the specified time window.";
        } else {
          result += formatEventsTable(limited);
          result += `\n\nTotal: ${limited.length} events (${normal} Normal, ${warning} Warning)`;
        }
        return truncateOutput(result, MAX_OUTPUT_BYTES);
      }

      case "export": {
        let events = allEvents;
        const { resource_kind, resource_name, event_type, reason } = params;
        if (resource_kind || resource_name || event_type || reason) {
          events = filterEvents(events, { resource_kind, resource_name, event_type, reason });
        }
        const limited = events.slice(0, params.limit);
        if (params.format === "json") {
          return truncateOutput(formatEventsJson(limited), MAX_OUTPUT_BYTES);
        }
        let result = `Exported events from ${nsLabel} (${limited.length} events)\n\n`;
        result += formatEventsTable(limited);
        return truncateOutput(result, MAX_OUTPUT_BYTES);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `events ${params.action}`));
  }
}

// --- Registration ---
