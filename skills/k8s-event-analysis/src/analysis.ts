import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatTable, formatAge, truncateOutput } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";
import { DEFAULT_NAMESPACE, MAX_OUTPUT_BYTES } from "../../../lib/types.js";
import { getEventTimestamp } from "../../k8s-events/src/events.js";

// --- Schema ---

const K8sEventAnalysisSchema = z.object({
  action: z.enum(["timeline", "anomaly", "correlate", "summary"]),
  namespace: z.string().default(DEFAULT_NAMESPACE),
  all_namespaces: z.boolean().default(false),
  since_minutes: z.number().int().positive().default(60),
  resource_kind: z.string().optional(),
  resource_name: z.string().optional(),
  warning_threshold: z.number().int().positive().default(5),
  time_window_minutes: z.number().int().positive().default(30),
  context: z.string().optional(),
});

type K8sEventAnalysisParams = z.infer<typeof K8sEventAnalysisSchema>;

// --- Constants ---

export const KNOWN_ANOMALY_PATTERNS = [
  "BackOff",
  "OOMKilled",
  "FailedScheduling",
  "Evicted",
  "FailedMount",
  "ImagePullBackOff",
  "NodeNotReady",
];

// --- Pure functions (exported for testing) ---

export function buildResourceKey(event: k8s.CoreV1Event): string {
  const kind = event.involvedObject?.kind || "?";
  const name = event.involvedObject?.name || "?";
  return `${kind}/${name}`;
}

interface TimeBucket {
  start: Date;
  end: Date;
  events: k8s.CoreV1Event[];
  normalCount: number;
  warningCount: number;
  reasonCounts: Record<string, number>;
}

export function groupEventsByTimeBucket(
  events: k8s.CoreV1Event[],
  bucketMinutes: number,
  now?: number
): TimeBucket[] {
  if (events.length === 0) return [];

  const bucketMs = bucketMinutes * 60 * 1000;

  const bucketMap = new Map<number, TimeBucket>();

  for (const event of events) {
    const ts = getEventTimestamp(event).getTime();
    const key = Math.floor(ts / bucketMs) * bucketMs;

    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        start: new Date(key),
        end: new Date(key + bucketMs),
        events: [],
        normalCount: 0,
        warningCount: 0,
        reasonCounts: {},
      });
    }

    const bucket = bucketMap.get(key)!;
    bucket.events.push(event);
    if (event.type === "Warning") bucket.warningCount++;
    else bucket.normalCount++;
    const reason = event.reason || "Unknown";
    bucket.reasonCounts[reason] = (bucket.reasonCounts[reason] || 0) + 1;
  }

  return Array.from(bucketMap.values()).sort((a, b) => b.start.getTime() - a.start.getTime());
}

interface AnomalyResult {
  knownAnomalies: Array<{ reason: string; resource: string; count: number }>;
  highFrequency: Array<{ resource: string; count: number }>;
}

export function detectAnomalies(
  events: k8s.CoreV1Event[],
  warningThreshold: number,
  _timeWindowMinutes: number
): AnomalyResult {
  const warningEvents = events.filter((e) => e.type === "Warning");

  const anomalyMap = new Map<string, Map<string, number>>();
  for (const event of warningEvents) {
    const reason = event.reason || "";
    if (KNOWN_ANOMALY_PATTERNS.some((p) => reason.includes(p))) {
      const resource = buildResourceKey(event);
      if (!anomalyMap.has(reason)) anomalyMap.set(reason, new Map());
      const resourceMap = anomalyMap.get(reason)!;
      resourceMap.set(resource, (resourceMap.get(resource) || 0) + 1);
    }
  }

  const knownAnomalies: AnomalyResult["knownAnomalies"] = [];
  for (const [reason, resourceMap] of anomalyMap) {
    for (const [resource, count] of resourceMap) {
      knownAnomalies.push({ reason, resource, count });
    }
  }

  const resourceWarningCount = new Map<string, number>();
  for (const event of warningEvents) {
    const resource = buildResourceKey(event);
    resourceWarningCount.set(resource, (resourceWarningCount.get(resource) || 0) + 1);
  }

  const highFrequency: AnomalyResult["highFrequency"] = [];
  for (const [resource, count] of resourceWarningCount) {
    if (count >= warningThreshold) {
      highFrequency.push({ resource, count });
    }
  }
  highFrequency.sort((a, b) => b.count - a.count);

  return { knownAnomalies, highFrequency };
}

interface HealthScoreInput {
  totalEvents: number;
  warningCount: number;
  anomalyCounts: Record<string, number>;
}

export function calculateHealthScore(input: HealthScoreInput): number {
  let score = 100;

  score -= Math.min(input.warningCount * 2, 40);

  const caps: Record<string, { perItem: number; max: number }> = {
    CrashLoopBackOff: { perItem: 10, max: 30 },
    BackOff: { perItem: 10, max: 30 },
    OOMKilled: { perItem: 10, max: 30 },
    FailedScheduling: { perItem: 8, max: 24 },
  };

  for (const [reason, count] of Object.entries(input.anomalyCounts)) {
    const cap = caps[reason] || { perItem: 5, max: 15 };
    score -= Math.min(count * cap.perItem, cap.max);
  }

  return Math.max(0, score);
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

async function fetchEventsForResource(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  kind: string,
  name: string
): Promise<k8s.CoreV1Event[]> {
  const ns = kind === "Node" ? "default" : namespace;
  const response = await coreApi.listNamespacedEvent(ns);
  return (response.body.items || []).filter(
    (e) => e.involvedObject?.kind === kind && e.involvedObject?.name === name
  );
}

// --- Correlate traversal ---

interface CorrelationResult {
  chain: string[];
  eventsByResource: Map<string, k8s.CoreV1Event[]>;
}

async function correlateResource(
  coreApi: k8s.CoreV1Api,
  appsApi: k8s.AppsV1Api,
  namespace: string,
  kind: string,
  name: string
): Promise<CorrelationResult> {
  const chain: string[] = [`${kind}/${name}`];
  const eventsByResource = new Map<string, k8s.CoreV1Event[]>();

  const primaryEvents = await fetchEventsForResource(coreApi, namespace, kind, name);
  eventsByResource.set(`${kind}/${name}`, primaryEvents);

  try {
    switch (kind) {
      case "Pod": {
        const podResp = await coreApi.readNamespacedPod(name, namespace);
        const pod = podResp.body;
        const owners = pod.metadata?.ownerReferences || [];
        const rsOwner = owners.find((o) => o.kind === "ReplicaSet");

        if (rsOwner) {
          chain.push(`ReplicaSet/${rsOwner.name}`);
          const rsEvents = await fetchEventsForResource(coreApi, namespace, "ReplicaSet", rsOwner.name);
          eventsByResource.set(`ReplicaSet/${rsOwner.name}`, rsEvents);

          const rsResp = await appsApi.readNamespacedReplicaSet(rsOwner.name, namespace);
          const rsOwners = rsResp.body.metadata?.ownerReferences || [];
          const deployOwner = rsOwners.find((o) => o.kind === "Deployment");
          if (deployOwner) {
            chain.push(`Deployment/${deployOwner.name}`);
            const deployEvents = await fetchEventsForResource(coreApi, namespace, "Deployment", deployOwner.name);
            eventsByResource.set(`Deployment/${deployOwner.name}`, deployEvents);
          }
        }

        const nodeName = pod.spec?.nodeName;
        if (nodeName) {
          chain.push(`Node/${nodeName}`);
          const nodeEvents = await fetchEventsForResource(coreApi, "default", "Node", nodeName);
          eventsByResource.set(`Node/${nodeName}`, nodeEvents);
        }
        break;
      }

      case "Deployment": {
        const rsListResp = await appsApi.listNamespacedReplicaSet(namespace);
        const ownedRSs = (rsListResp.body.items || []).filter((rs) =>
          rs.metadata?.ownerReferences?.some((o) => o.kind === "Deployment" && o.name === name)
        );

        for (const rs of ownedRSs.slice(0, 3)) {
          const rsName = rs.metadata!.name!;
          chain.push(`ReplicaSet/${rsName}`);
          const rsEvents = await fetchEventsForResource(coreApi, namespace, "ReplicaSet", rsName);
          eventsByResource.set(`ReplicaSet/${rsName}`, rsEvents);
        }

        const podListResp = await coreApi.listNamespacedPod(namespace);
        const ownedPods = (podListResp.body.items || []).filter((pod) =>
          pod.metadata?.ownerReferences?.some((o) => o.kind === "ReplicaSet" && ownedRSs.some((rs) => rs.metadata?.name === o.name))
        );

        for (const pod of ownedPods.slice(0, 10)) {
          const podName = pod.metadata!.name!;
          chain.push(`Pod/${podName}`);
          const podEvents = await fetchEventsForResource(coreApi, namespace, "Pod", podName);
          eventsByResource.set(`Pod/${podName}`, podEvents);
        }
        break;
      }

      case "ReplicaSet": {
        const rsResp = await appsApi.readNamespacedReplicaSet(name, namespace);
        const owners = rsResp.body.metadata?.ownerReferences || [];
        const deployOwner = owners.find((o) => o.kind === "Deployment");
        if (deployOwner) {
          chain.push(`Deployment/${deployOwner.name}`);
          const deployEvents = await fetchEventsForResource(coreApi, namespace, "Deployment", deployOwner.name);
          eventsByResource.set(`Deployment/${deployOwner.name}`, deployEvents);
        }

        const podListResp = await coreApi.listNamespacedPod(namespace);
        const ownedPods = (podListResp.body.items || []).filter((pod) =>
          pod.metadata?.ownerReferences?.some((o) => o.kind === "ReplicaSet" && o.name === name)
        );

        for (const pod of ownedPods.slice(0, 10)) {
          const podName = pod.metadata!.name!;
          chain.push(`Pod/${podName}`);
          const podEvents = await fetchEventsForResource(coreApi, namespace, "Pod", podName);
          eventsByResource.set(`Pod/${podName}`, podEvents);
        }
        break;
      }

      case "Node": {
        const podListResp = await coreApi.listNamespacedPod(namespace);
        const nodePods = (podListResp.body.items || []).filter((pod) => pod.spec?.nodeName === name);

        for (const pod of nodePods.slice(0, 10)) {
          const podName = pod.metadata!.name!;
          chain.push(`Pod/${podName}`);
          const podEvents = await fetchEventsForResource(coreApi, namespace, "Pod", podName);
          eventsByResource.set(`Pod/${podName}`, podEvents);
        }
        break;
      }
    }
  } catch {
    // If traversal fails, return what we have
  }

  return { chain, eventsByResource };
}

// --- Handler ---

async function handleK8sEventAnalysis(params: K8sEventAnalysisParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi, appsApi } = createK8sClients(pluginConfig, params.context);
    const nsLabel = params.all_namespaces ? "all namespaces" : `namespace=${params.namespace}`;

    switch (params.action) {
      case "timeline": {
        const allEvents = await fetchEvents(coreApi, params.namespace, params.all_namespaces);
        const cutoff = new Date(Date.now() - params.since_minutes * 60 * 1000);
        const recentEvents = allEvents.filter((e) => getEventTimestamp(e) >= cutoff);

        if (recentEvents.length === 0) {
          return `Event Timeline: ${nsLabel} (last ${params.since_minutes}min)\n\nNo events in the specified time window.`;
        }

        const buckets = groupEventsByTimeBucket(recentEvents, 5);
        let result = `Event Timeline: ${nsLabel} (last ${params.since_minutes}min, 5min buckets)\n\n`;

        const headers = ["TIME RANGE", "NORMAL", "WARNING", "DETAILS"];
        const rows = buckets.map((b) => {
          const start = b.start.toISOString().slice(11, 16);
          const end = b.end.toISOString().slice(11, 16);
          const details = Object.entries(b.reasonCounts)
            .map(([reason, count]) => `${reason}(${count})`)
            .join(", ");
          const prefix = b.warningCount > 0 ? "[!] " : "";
          return [`${start}-${end}`, b.normalCount.toString(), b.warningCount.toString(), `${prefix}${details}`];
        });

        result += formatTable(headers, rows);
        const totalNormal = buckets.reduce((sum, b) => sum + b.normalCount, 0);
        const totalWarning = buckets.reduce((sum, b) => sum + b.warningCount, 0);
        result += `\n\nTotal: ${recentEvents.length} events across ${buckets.length} buckets (${totalNormal} Normal, ${totalWarning} Warning)`;
        return truncateOutput(result, MAX_OUTPUT_BYTES);
      }

      case "anomaly": {
        const allEvents = await fetchEvents(coreApi, params.namespace, params.all_namespaces);
        const cutoff = new Date(Date.now() - params.time_window_minutes * 60 * 1000);
        const recentEvents = allEvents.filter((e) => getEventTimestamp(e) >= cutoff);
        const anomalyResult = detectAnomalies(recentEvents, params.warning_threshold, params.time_window_minutes);

        let result = `Anomaly Report: ${nsLabel} (last ${params.time_window_minutes}min, threshold=${params.warning_threshold})\n\n`;

        if (anomalyResult.knownAnomalies.length === 0 && anomalyResult.highFrequency.length === 0) {
          result += "No anomalies detected.\nStatus: HEALTHY";
          return result;
        }

        if (anomalyResult.knownAnomalies.length > 0) {
          result += "CRITICAL ANOMALIES:\n";
          for (const a of anomalyResult.knownAnomalies) {
            result += `  ${a.reason.padEnd(20)} ${a.resource.padEnd(30)} ${a.count} events\n`;
          }
          result += "\n";
        }

        if (anomalyResult.highFrequency.length > 0) {
          result += "HIGH-FREQUENCY WARNINGS:\n";
          for (const h of anomalyResult.highFrequency) {
            result += `  ${h.resource.padEnd(30)} ${h.count} Warning events (threshold: ${params.warning_threshold})\n`;
          }
          result += "\n";
        }

        result += `Summary: ${anomalyResult.knownAnomalies.length} known anomaly patterns, ${anomalyResult.highFrequency.length} high-frequency resources\n`;
        result += "Status: ACTION REQUIRED";
        return truncateOutput(result, MAX_OUTPUT_BYTES);
      }

      case "correlate": {
        if (!params.resource_kind || !params.resource_name) {
          return "Error: resource_kind and resource_name are both required for correlate action.";
        }

        const { chain, eventsByResource } = await correlateResource(
          coreApi, appsApi, params.namespace, params.resource_kind, params.resource_name
        );

        let totalEvents = 0;
        for (const events of eventsByResource.values()) totalEvents += events.length;

        let result = `Event Correlation: ${params.resource_kind}/${params.resource_name} in ${nsLabel}\n`;
        result += `Chain: ${chain.join(" → ")}\n\n`;

        if (totalEvents === 0) {
          result += "No events found for any resource in the chain.";
          return result;
        }

        for (const [resource, events] of eventsByResource) {
          if (events.length === 0) continue;
          result += `--- ${resource} (${events.length} events) ---\n`;
          const headers = ["TIME", "TYPE", "REASON", "MESSAGE"];
          const rows = events
            .sort((a, b) => getEventTimestamp(b).getTime() - getEventTimestamp(a).getTime())
            .slice(0, 10)
            .map((e) => [
              formatAge(getEventTimestamp(e)),
              e.type || "?",
              e.reason || "?",
              (e.message || "").slice(0, 60),
            ]);
          result += formatTable(headers, rows);
          result += "\n\n";
        }

        result += `Total: ${totalEvents} events across ${eventsByResource.size} resources`;
        return truncateOutput(result, MAX_OUTPUT_BYTES);
      }

      case "summary": {
        const allEvents = await fetchEvents(coreApi, params.namespace, params.all_namespaces);
        const cutoff = new Date(Date.now() - params.since_minutes * 60 * 1000);
        const recentEvents = allEvents.filter((e) => getEventTimestamp(e) >= cutoff);

        const warningEvents = recentEvents.filter((e) => e.type === "Warning");
        const normalCount = recentEvents.length - warningEvents.length;

        const anomalyCounts: Record<string, number> = {};
        for (const event of warningEvents) {
          const reason = event.reason || "Unknown";
          if (KNOWN_ANOMALY_PATTERNS.some((p) => reason.includes(p))) {
            anomalyCounts[reason] = (anomalyCounts[reason] || 0) + 1;
          }
        }

        const score = calculateHealthScore({
          totalEvents: recentEvents.length,
          warningCount: warningEvents.length,
          anomalyCounts,
        });

        let result = `Event Summary: ${nsLabel} (last ${params.since_minutes}min)\n\n`;
        result += `Health Score: ${score}/100\n\n`;

        const totalCount = recentEvents.length;
        const normalPct = totalCount > 0 ? ((normalCount / totalCount) * 100).toFixed(0) : "0";
        const warningPct = totalCount > 0 ? ((warningEvents.length / totalCount) * 100).toFixed(0) : "0";
        result += `Event Types:\n`;
        result += `  Normal:  ${normalCount} (${normalPct}%)\n`;
        result += `  Warning: ${warningEvents.length} (${warningPct}%)\n\n`;

        const reasonCounts = new Map<string, { count: number; resources: Set<string> }>();
        for (const e of warningEvents) {
          const reason = e.reason || "Unknown";
          if (!reasonCounts.has(reason)) reasonCounts.set(reason, { count: 0, resources: new Set() });
          const entry = reasonCounts.get(reason)!;
          entry.count++;
          entry.resources.add(buildResourceKey(e));
        }

        if (reasonCounts.size > 0) {
          result += "Top Warning Reasons:\n";
          const sorted = [...reasonCounts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
          for (const [reason, data] of sorted) {
            result += `  ${reason.padEnd(20)} ${data.count} events (${data.resources.size} resources)\n`;
          }
          result += "\n";
        }

        const resourceCounts = new Map<string, number>();
        for (const e of recentEvents) {
          const key = buildResourceKey(e);
          resourceCounts.set(key, (resourceCounts.get(key) || 0) + 1);
        }

        const topResources = [...resourceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (topResources.length > 0) {
          result += "Most Active Resources:\n";
          for (const [resource, count] of topResources) {
            result += `  ${resource.padEnd(30)} ${count} events\n`;
          }
        }

        return truncateOutput(result, MAX_OUTPUT_BYTES);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `event-analysis ${params.action}`));
  }
}

// --- Registration ---

export function registerK8sEventAnalysisTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_event_analysis",
    description:
      "Kubernetes event analysis: event timeline, anomaly detection, cross-resource correlation, namespace health summary",
    schema: K8sEventAnalysisSchema,
    handler: async (params: K8sEventAnalysisParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sEventAnalysis(params, pluginConfig);
    },
  });
}
