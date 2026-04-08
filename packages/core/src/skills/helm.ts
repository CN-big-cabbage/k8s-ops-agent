import { execFile } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { formatTable } from "../lib/format.js";
import type { PluginConfig } from "../lib/types.js";

const execFileAsync = promisify(execFile);

export const K8sHelmSchema = z.object({
  action: z.enum([
    "list",
    "status",
    "history",
    "values",
    "diff",
    "rollback",
    "uninstall",
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  release_name: z.string().optional(),
  revision: z.number().optional(),
  output_format: z.enum(["table", "json", "yaml"]).optional(),
  context: z.string().optional(),
});

export type K8sHelmParams = z.infer<typeof K8sHelmSchema>;

interface HelmRelease {
  name: string;
  namespace: string;
  revision: string;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
}

interface HelmHistoryEntry {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
  description: string;
}

export async function execHelm(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("helm", args, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(
        "helm CLI not found. Please install helm: https://helm.sh/docs/intro/install/"
      );
    }
    if (error instanceof Error && "stderr" in error) {
      const stderr = (error as { stderr: string }).stderr;
      if (stderr) {
        throw new Error(`helm error: ${stderr.trim()}`);
      }
    }
    throw error;
  }
}

function buildNamespaceArgs(namespace?: string, allNamespaces?: boolean): string[] {
  if (allNamespaces) return ["-A"];
  if (namespace) return ["-n", namespace];
  return [];
}

function formatReleaseList(releases: HelmRelease[]): string {
  if (releases.length === 0) {
    return "No releases found.";
  }

  const headers = ["NAMESPACE", "NAME", "REVISION", "STATUS", "CHART", "APP-VERSION", "UPDATED"];
  const rows = releases.map((r) => [
    r.namespace,
    r.name,
    r.revision,
    r.status,
    r.chart,
    r.app_version,
    r.updated,
  ]);

  return formatTable(headers, rows);
}

function formatReleaseStatus(data: Record<string, unknown>): string {
  let result = `Name: ${data.name || "unknown"}\n`;
  result += `Namespace: ${data.namespace || "—"}\n`;
  result += `Status: ${data.info && typeof data.info === "object" ? (data.info as Record<string, unknown>).status : "—"}\n`;
  result += `Revision: ${data.version || "—"}\n`;

  const info = data.info as Record<string, unknown> | undefined;
  if (info) {
    result += `Last Deployed: ${info.last_deployed || "—"}\n`;
    result += `Description: ${info.description || "—"}\n`;

    if (info.notes) {
      result += `\n--- Notes ---\n${info.notes}\n`;
    }
  }

  return result;
}

function formatReleaseHistory(entries: HelmHistoryEntry[]): string {
  if (entries.length === 0) {
    return "No revision history found.";
  }

  const headers = ["REVISION", "STATUS", "CHART", "APP-VERSION", "DESCRIPTION"];
  const rows = entries.map((e) => [
    String(e.revision),
    e.status,
    e.chart,
    e.app_version,
    e.description,
  ]);

  return formatTable(headers, rows);
}

function formatValuesDiff(
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  oldRev: number,
  newRev: number
): string {
  const changes = diffObjects("", oldValues, newValues);

  if (changes.length === 0) {
    return `Values diff: revision ${oldRev} → ${newRev}\nNo differences found.`;
  }

  const lines = [`Values diff: revision ${oldRev} → ${newRev}`];
  for (const change of changes) {
    lines.push(change);
  }

  return lines.join("\n");
}

function diffObjects(prefix: string, oldObj: Record<string, unknown>, newObj: Record<string, unknown>): string[] {
  const changes: string[] = [];
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (!(key in oldObj)) {
      changes.push(`+ ${path}: ${JSON.stringify(newVal)}`);
    } else if (!(key in newObj)) {
      changes.push(`- ${path}: ${JSON.stringify(oldVal)}`);
    } else if (
      typeof oldVal === "object" &&
      oldVal !== null &&
      typeof newVal === "object" &&
      newVal !== null &&
      !Array.isArray(oldVal) &&
      !Array.isArray(newVal)
    ) {
      changes.push(
        ...diffObjects(
          path,
          oldVal as Record<string, unknown>,
          newVal as Record<string, unknown>
        )
      );
    } else if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push(`~ ${path}: ${JSON.stringify(oldVal)} → ${JSON.stringify(newVal)}`);
    }
  }

  return changes;
}

export async function handleK8sHelm(
  params: K8sHelmParams,
  _pluginConfig?: PluginConfig
): Promise<string> {
  switch (params.action) {
    case "list": {
      const nsArgs = buildNamespaceArgs(params.namespace, params.all_namespaces);
      const stdout = await execHelm(["list", ...nsArgs, "-o", "json"]);
      const releases: HelmRelease[] = JSON.parse(stdout);
      return formatReleaseList(releases);
    }

    case "status": {
      if (!params.release_name) {
        throw new Error("release_name is required for status action");
      }
      const nsArgs = buildNamespaceArgs(params.namespace);
      const stdout = await execHelm(["status", params.release_name, ...nsArgs, "-o", "json"]);
      const data = JSON.parse(stdout);
      return formatReleaseStatus(data);
    }

    case "history": {
      if (!params.release_name) {
        throw new Error("release_name is required for history action");
      }
      const nsArgs = buildNamespaceArgs(params.namespace);
      const stdout = await execHelm(["history", params.release_name, ...nsArgs, "-o", "json"]);
      const entries: HelmHistoryEntry[] = JSON.parse(stdout);
      return formatReleaseHistory(entries);
    }

    case "values": {
      if (!params.release_name) {
        throw new Error("release_name is required for values action");
      }
      const nsArgs = buildNamespaceArgs(params.namespace);
      const args = ["get", "values", params.release_name, ...nsArgs, "-o", "json"];
      if (params.revision !== undefined) {
        args.push("--revision", String(params.revision));
      }
      const stdout = await execHelm(args);
      return stdout.trim();
    }

    case "diff": {
      if (!params.release_name) {
        throw new Error("release_name is required for diff action");
      }
      if (params.revision === undefined) {
        throw new Error("revision is required for diff action (target revision to compare with current)");
      }
      const nsArgs = buildNamespaceArgs(params.namespace);

      const currentStdout = await execHelm([
        "get", "values", params.release_name, ...nsArgs, "-o", "json",
      ]);
      const targetStdout = await execHelm([
        "get", "values", params.release_name, ...nsArgs, "-o", "json",
        "--revision", String(params.revision),
      ]);

      const currentValues = JSON.parse(currentStdout);
      const targetValues = JSON.parse(targetStdout);

      const historyStdout = await execHelm([
        "history", params.release_name, ...nsArgs, "-o", "json",
      ]);
      const history: HelmHistoryEntry[] = JSON.parse(historyStdout);
      const currentRev = history.length > 0 ? history[history.length - 1].revision : 0;

      return formatValuesDiff(targetValues, currentValues, params.revision, currentRev);
    }

    case "rollback": {
      if (!params.release_name) {
        throw new Error("release_name is required for rollback action");
      }
      if (params.revision === undefined) {
        throw new Error("revision is required for rollback action");
      }
      const nsArgs = buildNamespaceArgs(params.namespace);
      const stdout = await execHelm([
        "rollback", params.release_name, String(params.revision), ...nsArgs,
      ]);
      return stdout.trim() || `Rollback of ${params.release_name} to revision ${params.revision} completed`;
    }

    case "uninstall": {
      if (!params.release_name) {
        throw new Error("release_name is required for uninstall action");
      }
      const nsArgs = buildNamespaceArgs(params.namespace);
      const stdout = await execHelm(["uninstall", params.release_name, ...nsArgs]);
      return stdout.trim() || `Release ${params.release_name} uninstalled`;
    }

    default:
      throw new Error(`Unknown action: ${params.action}`);
  }
}

