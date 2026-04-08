import * as k8s from "@kubernetes/client-node";
import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { formatAge, formatTable } from "../lib/format.js";
import { wrapK8sError } from "../lib/errors.js";
import type { PluginConfig } from "../lib/types.js";

export const K8sCronJobSchema = z.object({
  action: z.enum(["list", "describe", "status", "suspend", "trigger", "history"]),
  namespace: z.string().optional(),
  cronjob_name: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  suspend: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
  context: z.string().optional(),
});

export type K8sCronJobParams = z.infer<typeof K8sCronJobSchema>;

function formatCronJobList(cronJobs: k8s.V1CronJob[]): string {
  if (cronJobs.length === 0) {
    return "No cronjobs found.";
  }

  const headers = ["NAMESPACE", "NAME", "SCHEDULE", "SUSPEND", "ACTIVE", "LAST-SCHEDULE", "AGE"];
  const rows = cronJobs.map((cj) => {
    const namespace = cj.metadata?.namespace || "unknown";
    const name = cj.metadata?.name || "unknown";
    const schedule = cj.spec?.schedule || "—";
    const suspend = cj.spec?.suspend ? "True" : "False";
    const active = (cj.status?.active || []).length.toString();
    const lastSchedule = cj.status?.lastScheduleTime
      ? formatAge(new Date(cj.status.lastScheduleTime))
      : "—";
    const creationTime = cj.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";
    return [namespace, name, schedule, suspend, active, lastSchedule, age];
  });

  return formatTable(headers, rows);
}

function formatCronJobDescribe(cj: k8s.V1CronJob): string {
  const name = cj.metadata?.name || "unknown";
  const namespace = cj.metadata?.namespace || "unknown";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `CreationTimestamp: ${cj.metadata?.creationTimestamp || "unknown"}\n`;

  result += `\n--- Schedule ---\n`;
  result += `  Schedule: ${cj.spec?.schedule || "—"}\n`;
  result += `  Suspend: ${cj.spec?.suspend ? "True" : "False"}\n`;
  result += `  ConcurrencyPolicy: ${cj.spec?.concurrencyPolicy || "Allow"}\n`;

  result += `\n--- History Limits ---\n`;
  result += `  SuccessfulJobsHistoryLimit: ${cj.spec?.successfulJobsHistoryLimit ?? 3}\n`;
  result += `  FailedJobsHistoryLimit: ${cj.spec?.failedJobsHistoryLimit ?? 1}\n`;

  result += `\n--- Status ---\n`;
  result += `  LastScheduleTime: ${cj.status?.lastScheduleTime || "—"}\n`;
  result += `  Active Jobs: ${(cj.status?.active || []).length}\n`;

  result += `\n--- Job Template ---\n`;
  const containers = cj.spec?.jobTemplate?.spec?.template?.spec?.containers || [];
  containers.forEach((container) => {
    result += `  Container: ${container.name}\n`;
    result += `    Image: ${container.image}\n`;
    if (container.command) {
      result += `    Command: ${container.command.join(" ")}\n`;
    }
  });

  return result;
}

function formatCronJobStatus(cj: k8s.V1CronJob): string {
  const name = cj.metadata?.name || "unknown";
  const namespace = cj.metadata?.namespace || "unknown";
  const suspended = cj.spec?.suspend || false;

  let result = `CronJob: ${namespace}/${name}\n`;
  result += `Schedule: ${cj.spec?.schedule || "—"}\n`;
  result += `Status: ${suspended ? "Suspended" : "Active"}\n`;
  result += `Active Jobs: ${(cj.status?.active || []).length}\n`;

  if (cj.status?.lastScheduleTime) {
    result += `Last Schedule: ${formatAge(new Date(cj.status.lastScheduleTime))} ago\n`;
  }

  if (suspended) {
    result += `\n⏸ CronJob is suspended`;
  } else {
    result += `\n✓ CronJob is active`;
  }

  return result;
}

export async function handleK8sCronJob(
  params: K8sCronJobParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const { batchApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let cronJobs: k8s.V1CronJob[];

        if (params.all_namespaces) {
          const response = await batchApi.listCronJobForAllNamespaces(
            undefined, undefined, undefined, params.label_selector
          );
          cronJobs = response.body.items;
        } else {
          const response = await batchApi.listNamespacedCronJob(
            namespace, undefined, undefined, undefined, undefined, params.label_selector
          );
          cronJobs = response.body.items;
        }

        return formatCronJobList(cronJobs);
      }

      case "describe": {
        if (!params.cronjob_name) {
          throw new Error("cronjob_name is required for describe action");
        }

        const response = await batchApi.readNamespacedCronJob(
          params.cronjob_name, namespace
        );

        return formatCronJobDescribe(response.body);
      }

      case "status": {
        if (!params.cronjob_name) {
          throw new Error("cronjob_name is required for status action");
        }

        const response = await batchApi.readNamespacedCronJob(
          params.cronjob_name, namespace
        );

        return formatCronJobStatus(response.body);
      }

      case "suspend": {
        if (!params.cronjob_name) {
          throw new Error("cronjob_name is required for suspend action");
        }

        const shouldSuspend = params.suspend !== undefined ? params.suspend : true;

        await batchApi.patchNamespacedCronJob(
          params.cronjob_name, namespace,
          { spec: { suspend: shouldSuspend } },
          undefined, undefined, undefined, undefined,
          { headers: { "Content-Type": "application/strategic-merge-patch+json" } } as unknown as boolean
        );

        const action = shouldSuspend ? "suspended" : "resumed";
        return `CronJob ${namespace}/${params.cronjob_name} ${action}`;
      }

      case "trigger": {
        if (!params.cronjob_name) {
          throw new Error("cronjob_name is required for trigger action");
        }

        const cjResponse = await batchApi.readNamespacedCronJob(
          params.cronjob_name, namespace
        );

        const jobTemplate = cjResponse.body.spec?.jobTemplate;
        if (!jobTemplate) {
          throw new Error("CronJob has no jobTemplate");
        }

        const timestamp = Date.now();
        const jobName = `${params.cronjob_name}-manual-${timestamp}`;

        const job: k8s.V1Job = {
          apiVersion: "batch/v1",
          kind: "Job",
          metadata: {
            name: jobName,
            namespace,
            annotations: {
              "cronjob.kubernetes.io/instantiate": "manual",
            },
          },
          spec: jobTemplate.spec,
        };

        await batchApi.createNamespacedJob(namespace, job);

        return `CronJob ${namespace}/${params.cronjob_name} triggered manually. Job created: ${jobName}`;
      }

      case "history": {
        if (!params.cronjob_name) {
          throw new Error("cronjob_name is required for history action");
        }

        const jobsResponse = await batchApi.listNamespacedJob(namespace);
        const ownedJobs = jobsResponse.body.items.filter((job) =>
          job.metadata?.ownerReferences?.some(
            (ref) => ref.kind === "CronJob" && ref.name === params.cronjob_name
          )
        );

        if (ownedJobs.length === 0) {
          return `No jobs found for CronJob ${params.cronjob_name}`;
        }

        const sorted = ownedJobs.sort((a, b) => {
          const timeA = a.metadata?.creationTimestamp ? new Date(a.metadata.creationTimestamp).getTime() : 0;
          const timeB = b.metadata?.creationTimestamp ? new Date(b.metadata.creationTimestamp).getTime() : 0;
          return timeB - timeA;
        });

        const limit = params.limit || 10;
        const limited = sorted.slice(0, limit);

        const headers = ["NAME", "COMPLETIONS", "STATUS", "AGE"];
        const rows = limited.map((job) => {
          const name = job.metadata?.name || "unknown";
          const completions = job.spec?.completions || 1;
          const succeeded = job.status?.succeeded || 0;
          const completionsStr = `${succeeded}/${completions}`;

          let status = "Running";
          if (succeeded >= completions) status = "Complete";
          else if ((job.status?.failed || 0) > 0 && (job.status?.active || 0) === 0) status = "Failed";

          const creationTime = job.metadata?.creationTimestamp;
          const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";
          return [name, completionsStr, status, age];
        });

        let result = `Job history for CronJob ${params.cronjob_name}:\n\n`;
        result += formatTable(headers, rows);
        return result;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `cronjob ${params.action}`));
  }
}

