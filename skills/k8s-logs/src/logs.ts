import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatTable, truncateOutput } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";
import { DEFAULT_NAMESPACE, DEFAULT_LOG_LINES, MAX_LOG_LINES } from "../../../lib/types.js";

const K8sLogsSchema = z.object({
  action: z.enum(["search", "multi_pod", "since", "compare", "stats", "export"]),
  namespace: z.string().default(DEFAULT_NAMESPACE),
  pod_name: z.string().optional(),
  label_selector: z.string().optional(),
  container: z.string().optional(),
  pattern: z.string().optional(),
  since_time: z.string().optional(),
  compare_pods: z.tuple([z.string(), z.string()]).optional(),
  tail_lines: z.number().int().positive().default(DEFAULT_LOG_LINES),
  context: z.string().optional(),
});

type K8sLogsParams = z.infer<typeof K8sLogsSchema>;

function parseRelativeTime(timeStr: string): Date {
  const match = timeStr.match(/^(\d+)(s|m|h|d)$/);
  if (!match) {
    // Try ISO 8601
    const date = new Date(timeStr);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid time format: ${timeStr}. Use relative (1h, 30m, 7d) or ISO 8601.`);
    }
    return date;
  }

  const value = parseInt(match[1]);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case "s": return new Date(now.getTime() - value * 1000);
    case "m": return new Date(now.getTime() - value * 60 * 1000);
    case "h": return new Date(now.getTime() - value * 60 * 60 * 1000);
    case "d": return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    default: throw new Error(`Unknown time unit: ${unit}`);
  }
}

async function fetchPodLogs(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  podName: string,
  container?: string,
  tailLines?: number,
  sinceTime?: Date
): Promise<string> {
  const response = await coreApi.readNamespacedPodLog(
    podName,
    namespace,
    container,
    undefined, // follow
    undefined, // insecureSkipTLSVerify
    undefined, // limitBytes
    undefined, // pretty
    undefined, // previous
    sinceTime ? Math.floor((Date.now() - sinceTime.getTime()) / 1000) : undefined, // sinceSeconds
    tailLines,
    undefined // timestamps
  );
  return response.body || "";
}

async function fetchPodLogsWithTimestamps(
  coreApi: k8s.CoreV1Api,
  namespace: string,
  podName: string,
  container?: string,
  tailLines?: number,
  sinceTime?: Date
): Promise<string> {
  const response = await coreApi.readNamespacedPodLog(
    podName,
    namespace,
    container,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    sinceTime ? Math.floor((Date.now() - sinceTime.getTime()) / 1000) : undefined,
    tailLines,
    true // timestamps
  );
  return response.body || "";
}

async function handleK8sLogs(params: K8sLogsParams, pluginConfig?: PluginConfig): Promise<string> {
  try {
    const { coreApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace;
    const tailLines = Math.min(params.tail_lines, MAX_LOG_LINES);

    switch (params.action) {
      case "search": {
        if (!params.pod_name) throw new Error("pod_name is required for search action");
        if (!params.pattern) throw new Error("pattern is required for search action");

        const sinceDate = params.since_time ? parseRelativeTime(params.since_time) : undefined;
        const logs = await fetchPodLogs(coreApi, namespace, params.pod_name, params.container, tailLines, sinceDate);

        if (!logs) return "No logs found.";

        const regex = new RegExp(params.pattern, "i");
        const lines = logs.split("\n");
        const matches: string[] = [];
        const contextLines = 2;

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const start = Math.max(0, i - contextLines);
            const end = Math.min(lines.length - 1, i + contextLines);

            if (matches.length > 0) matches.push("---");
            for (let j = start; j <= end; j++) {
              const prefix = j === i ? ">>>" : "   ";
              matches.push(`${prefix} ${lines[j]}`);
            }
          }
        }

        if (matches.length === 0) return `No matches found for pattern: ${params.pattern}`;

        return `Search results for "${params.pattern}" in ${namespace}/${params.pod_name}:\n\n${matches.join("\n")}`;
      }

      case "multi_pod": {
        if (!params.label_selector) throw new Error("label_selector is required for multi_pod action");

        const podsResponse = await coreApi.listNamespacedPod(
          namespace,
          undefined,
          undefined,
          undefined,
          undefined,
          params.label_selector
        );

        const pods = podsResponse.body.items;
        if (pods.length === 0) return `No pods found matching: ${params.label_selector}`;

        const sinceDate = params.since_time ? parseRelativeTime(params.since_time) : undefined;
        const perPodLines = Math.max(10, Math.floor(tailLines / pods.length));

        const logPromises = pods.map(async (pod) => {
          const podName = pod.metadata?.name || "unknown";
          try {
            const logs = await fetchPodLogsWithTimestamps(
              coreApi, namespace, podName, params.container, perPodLines, sinceDate
            );
            return logs.split("\n").filter(Boolean).map((line) => ({ podName, line }));
          } catch {
            return [{ podName, line: `(failed to fetch logs for ${podName})` }];
          }
        });

        const allLogs = (await Promise.all(logPromises)).flat();

        // Sort by timestamp if available
        allLogs.sort((a, b) => {
          const tsA = a.line.match(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z/)?.[0] || "";
          const tsB = b.line.match(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z/)?.[0] || "";
          return tsA.localeCompare(tsB);
        });

        let result = `Multi-pod logs (${pods.length} pods matching "${params.label_selector}"):\n\n`;
        allLogs.forEach(({ podName, line }) => {
          result += `[${podName}] ${line}\n`;
        });

        return result;
      }

      case "since": {
        if (!params.pod_name) throw new Error("pod_name is required for since action");
        if (!params.since_time) throw new Error("since_time is required for since action");

        const sinceDate = parseRelativeTime(params.since_time);
        const logs = await fetchPodLogs(coreApi, namespace, params.pod_name, params.container, tailLines, sinceDate);

        if (!logs) return `No logs found since ${params.since_time}`;

        return `Logs for ${namespace}/${params.pod_name} since ${params.since_time}:\n\n${logs}`;
      }

      case "compare": {
        if (!params.compare_pods) throw new Error("compare_pods is required for compare action");

        const [pod1, pod2] = params.compare_pods;
        const sinceDate = params.since_time ? parseRelativeTime(params.since_time) : undefined;
        const perPodLines = Math.floor(tailLines / 2);

        const [logs1, logs2] = await Promise.all([
          fetchPodLogs(coreApi, namespace, pod1, params.container, perPodLines, sinceDate),
          fetchPodLogs(coreApi, namespace, pod2, params.container, perPodLines, sinceDate),
        ]);

        const lines1 = logs1.split("\n").filter(Boolean);
        const lines2 = logs2.split("\n").filter(Boolean);

        let result = `Log comparison: ${pod1} vs ${pod2}\n`;
        result += `${"=".repeat(60)}\n\n`;

        result += `--- ${pod1} (${lines1.length} lines) ---\n`;
        result += lines1.join("\n");
        result += `\n\n--- ${pod2} (${lines2.length} lines) ---\n`;
        result += lines2.join("\n");

        // Find unique patterns
        const set1 = new Set(lines1.map((l) => l.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, "")));
        const set2 = new Set(lines2.map((l) => l.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, "")));

        const onlyIn1 = [...set1].filter((l) => !set2.has(l));
        const onlyIn2 = [...set2].filter((l) => !set1.has(l));

        if (onlyIn1.length > 0 || onlyIn2.length > 0) {
          result += `\n\n--- Differences ---\n`;
          if (onlyIn1.length > 0) {
            result += `\nOnly in ${pod1} (${onlyIn1.length}):\n`;
            onlyIn1.slice(0, 10).forEach((l) => { result += `  ${l}\n`; });
          }
          if (onlyIn2.length > 0) {
            result += `\nOnly in ${pod2} (${onlyIn2.length}):\n`;
            onlyIn2.slice(0, 10).forEach((l) => { result += `  ${l}\n`; });
          }
        }

        return result;
      }

      case "stats": {
        if (!params.pod_name) throw new Error("pod_name is required for stats action");

        const sinceDate = params.since_time ? parseRelativeTime(params.since_time) : undefined;
        const logs = await fetchPodLogs(coreApi, namespace, params.pod_name, params.container, tailLines, sinceDate);

        if (!logs) return "No logs found.";

        const lines = logs.split("\n").filter(Boolean);

        // Count log levels
        let errorCount = 0;
        let warnCount = 0;
        let infoCount = 0;
        let debugCount = 0;
        const errorMessages = new Map<string, number>();

        for (const line of lines) {
          const upper = line.toUpperCase();
          if (upper.includes("ERROR") || upper.includes("FATAL") || upper.includes("PANIC")) {
            errorCount++;
            // Extract error message (strip timestamp, take first 100 chars)
            const msg = line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s*/, "").substring(0, 100);
            errorMessages.set(msg, (errorMessages.get(msg) || 0) + 1);
          } else if (upper.includes("WARN")) {
            warnCount++;
          } else if (upper.includes("INFO")) {
            infoCount++;
          } else if (upper.includes("DEBUG") || upper.includes("TRACE")) {
            debugCount++;
          }
        }

        // If a custom pattern is provided, count it too
        let patternCount = 0;
        if (params.pattern) {
          const regex = new RegExp(params.pattern, "i");
          for (const line of lines) {
            if (regex.test(line)) patternCount++;
          }
        }

        let result = `Log Statistics for ${namespace}/${params.pod_name}:\n`;
        result += `Total lines analyzed: ${lines.length}\n\n`;

        result += `--- Level Distribution ---\n`;
        result += formatTable(
          ["LEVEL", "COUNT", "PERCENTAGE"],
          [
            ["ERROR/FATAL", errorCount.toString(), `${((errorCount / lines.length) * 100).toFixed(1)}%`],
            ["WARN", warnCount.toString(), `${((warnCount / lines.length) * 100).toFixed(1)}%`],
            ["INFO", infoCount.toString(), `${((infoCount / lines.length) * 100).toFixed(1)}%`],
            ["DEBUG/TRACE", debugCount.toString(), `${((debugCount / lines.length) * 100).toFixed(1)}%`],
          ]
        );

        if (params.pattern) {
          result += `\n\nCustom pattern "${params.pattern}": ${patternCount} matches`;
        }

        if (errorMessages.size > 0) {
          result += `\n\n--- Top Errors ---\n`;
          const sorted = [...errorMessages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
          sorted.forEach(([msg, count], i) => {
            result += `  ${i + 1}. (${count}x) ${msg}\n`;
          });
        }

        return result;
      }

      case "export": {
        if (!params.pod_name) throw new Error("pod_name is required for export action");

        const sinceDate = params.since_time ? parseRelativeTime(params.since_time) : undefined;
        const logs = await fetchPodLogsWithTimestamps(
          coreApi, namespace, params.pod_name, params.container, tailLines, sinceDate
        );

        if (!logs) return "[]";

        const lines = logs.split("\n").filter(Boolean);
        const entries = lines.map((line) => {
          const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s*(.*)/);
          if (tsMatch) {
            return { timestamp: tsMatch[1], message: tsMatch[2] };
          }
          return { timestamp: null, message: line };
        });

        return JSON.stringify({
          pod: params.pod_name,
          namespace,
          count: entries.length,
          logs: entries,
        }, null, 2);
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `logs ${params.action}`));
  }
}

export function registerK8sLogsTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_logs",
    description:
      "Advanced Kubernetes log operations: search, multi-pod aggregation, time-range filtering, compare, statistics, export",
    schema: K8sLogsSchema,
    handler: async (params: K8sLogsParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sLogs(params, pluginConfig);
    },
  });
}
