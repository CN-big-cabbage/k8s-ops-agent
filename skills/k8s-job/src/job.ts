import * as k8s from "@kubernetes/client-node";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { createK8sClients } from "../../../lib/client.js";
import { formatAge, formatTable } from "../../../lib/format.js";
import { wrapK8sError } from "../../../lib/errors.js";
import type { PluginConfig } from "../../../lib/types.js";

export const K8sJobSchema = z.object({
  action: z.enum(["list", "describe", "status", "logs", "delete", "create"]),
  namespace: z.string().optional(),
  job_name: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  image: z.string().optional(),
  command: z.array(z.string()).optional(),
  tail_lines: z.number().int().positive().optional(),
  context: z.string().optional(),
});

type K8sJobParams = z.infer<typeof K8sJobSchema>;

function formatDuration(startTime?: Date, completionTime?: Date): string {
  if (!startTime) return "—";
  const end = completionTime || new Date();
  const diffSec = Math.floor((new Date(end).getTime() - new Date(startTime).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${min}m${sec}s`;
}

function formatJobList(jobs: k8s.V1Job[]): string {
  if (jobs.length === 0) {
    return "No jobs found.";
  }

  const headers = ["NAMESPACE", "NAME", "COMPLETIONS", "DURATION", "AGE"];
  const rows = jobs.map((job) => {
    const namespace = job.metadata?.namespace || "unknown";
    const name = job.metadata?.name || "unknown";
    const completions = job.spec?.completions || 1;
    const succeeded = job.status?.succeeded || 0;
    const completionsStr = `${succeeded}/${completions}`;
    const duration = formatDuration(job.status?.startTime, job.status?.completionTime);
    const creationTime = job.metadata?.creationTimestamp;
    const age = creationTime ? formatAge(new Date(creationTime)) : "unknown";
    return [namespace, name, completionsStr, duration, age];
  });

  return formatTable(headers, rows);
}

function formatJobDescribe(
  job: k8s.V1Job,
  pods?: k8s.V1Pod[],
  events?: k8s.CoreV1Event[]
): string {
  const name = job.metadata?.name || "unknown";
  const namespace = job.metadata?.namespace || "unknown";

  let result = `Name: ${name}\n`;
  result += `Namespace: ${namespace}\n`;
  result += `CreationTimestamp: ${job.metadata?.creationTimestamp || "unknown"}\n`;

  result += `\n--- Spec ---\n`;
  result += `  Completions: ${job.spec?.completions || 1}\n`;
  result += `  Parallelism: ${job.spec?.parallelism || 1}\n`;
  result += `  BackoffLimit: ${job.spec?.backoffLimit ?? 6}\n`;

  result += `\n--- Status ---\n`;
  result += `  Active: ${job.status?.active || 0}\n`;
  result += `  Succeeded: ${job.status?.succeeded || 0}\n`;
  result += `  Failed: ${job.status?.failed || 0}\n`;

  if (job.status?.startTime) {
    result += `  StartTime: ${job.status.startTime}\n`;
  }
  if (job.status?.completionTime) {
    result += `  CompletionTime: ${job.status.completionTime}\n`;
    result += `  Duration: ${formatDuration(job.status.startTime, job.status.completionTime)}\n`;
  }

  const conditions = job.status?.conditions || [];
  if (conditions.length > 0) {
    result += `\n--- Conditions ---\n`;
    conditions.forEach((c) => {
      result += `  ${c.type}: ${c.status}\n`;
    });
  }

  result += `\n--- Template ---\n`;
  const containers = job.spec?.template?.spec?.containers || [];
  containers.forEach((container) => {
    result += `  Container: ${container.name}\n`;
    result += `    Image: ${container.image}\n`;
    if (container.command) {
      result += `    Command: ${container.command.join(" ")}\n`;
    }
  });
  result += `  RestartPolicy: ${job.spec?.template?.spec?.restartPolicy || "Never"}\n`;

  if (pods && pods.length > 0) {
    result += `\n--- Pods ---\n`;
    pods.forEach((pod) => {
      result += `  ${pod.metadata?.name}: ${pod.status?.phase || "unknown"}\n`;
    });
  }

  if (events && events.length > 0) {
    result += `\n--- Recent Events ---\n`;
    events.slice(0, 10).forEach((event) => {
      const time = event.lastTimestamp || event.firstTimestamp || "";
      result += `  [${time}] ${event.type}: ${event.reason} - ${event.message}\n`;
    });
  }

  return result;
}

function formatJobStatus(job: k8s.V1Job): string {
  const name = job.metadata?.name || "unknown";
  const namespace = job.metadata?.namespace || "unknown";
  const completions = job.spec?.completions || 1;
  const succeeded = job.status?.succeeded || 0;
  const active = job.status?.active || 0;
  const failed = job.status?.failed || 0;

  let result = `Job: ${namespace}/${name}\n`;
  result += `Completions: ${succeeded}/${completions}`;
  result += ` (active: ${active}, failed: ${failed})\n`;

  if (succeeded >= completions) {
    result += `\n✓ Job completed successfully`;
  } else if (failed > 0 && active === 0) {
    result += `\n✗ Job failed`;
  } else {
    result += `\n⟳ Job in progress...`;
  }

  return result;
}

export async function handleK8sJob(
  params: K8sJobParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    const { batchApi, coreApi } = createK8sClients(pluginConfig, params.context);
    const namespace = params.namespace || "default";

    switch (params.action) {
      case "list": {
        let jobs: k8s.V1Job[];

        if (params.all_namespaces) {
          const response = await batchApi.listJobForAllNamespaces(
            undefined, undefined, undefined, params.label_selector
          );
          jobs = response.body.items;
        } else {
          const response = await batchApi.listNamespacedJob(
            namespace, undefined, undefined, undefined, undefined, params.label_selector
          );
          jobs = response.body.items;
        }

        return formatJobList(jobs);
      }

      case "describe": {
        if (!params.job_name) {
          throw new Error("job_name is required for describe action");
        }

        const jobResponse = await batchApi.readNamespacedJob(
          params.job_name, namespace
        );

        let pods: k8s.V1Pod[] = [];
        try {
          const podResponse = await coreApi.listNamespacedPod(
            namespace, undefined, undefined, undefined, undefined,
            `job-name=${params.job_name}`
          );
          pods = podResponse.body.items;
        } catch {
          // Continue without pods
        }

        let events: k8s.CoreV1Event[] = [];
        try {
          const eventsResponse = await coreApi.listNamespacedEvent(
            namespace, undefined, undefined, undefined,
            `involvedObject.name=${params.job_name}`
          );
          events = eventsResponse.body.items;
        } catch {
          // Continue without events
        }

        return formatJobDescribe(jobResponse.body, pods, events);
      }

      case "status": {
        if (!params.job_name) {
          throw new Error("job_name is required for status action");
        }

        const response = await batchApi.readNamespacedJob(
          params.job_name, namespace
        );

        return formatJobStatus(response.body);
      }

      case "logs": {
        if (!params.job_name) {
          throw new Error("job_name is required for logs action");
        }

        const podResponse = await coreApi.listNamespacedPod(
          namespace, undefined, undefined, undefined, undefined,
          `job-name=${params.job_name}`
        );

        const pods = podResponse.body.items;
        if (pods.length === 0) {
          return `No pods found for job ${params.job_name}`;
        }

        const podName = pods[0].metadata?.name;
        if (!podName) {
          return `Pod name not found for job ${params.job_name}`;
        }

        const logResponse = await coreApi.readNamespacedPodLog(
          podName, namespace, undefined, undefined, undefined, undefined,
          undefined, undefined, undefined, params.tail_lines
        );

        return `--- Logs from ${podName} ---\n${logResponse.body}`;
      }

      case "create": {
        if (!params.job_name) {
          throw new Error("job_name is required for create action");
        }
        if (!params.image) {
          throw new Error("image is required for create action");
        }

        const job: k8s.V1Job = {
          apiVersion: "batch/v1",
          kind: "Job",
          metadata: {
            name: params.job_name,
            namespace,
          },
          spec: {
            template: {
              spec: {
                containers: [
                  {
                    name: params.job_name,
                    image: params.image,
                    command: params.command,
                  },
                ],
                restartPolicy: "Never",
              },
            },
            backoffLimit: 4,
          },
        };

        await batchApi.createNamespacedJob(namespace, job);

        return `Job ${namespace}/${params.job_name} created with image ${params.image}`;
      }

      case "delete": {
        if (!params.job_name) {
          throw new Error("job_name is required for delete action");
        }

        await batchApi.deleteNamespacedJob(
          params.job_name, namespace, undefined, undefined, undefined,
          undefined, "Background"
        );

        return `Job ${namespace}/${params.job_name} deleted (cascade: Background)`;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `job ${params.action}`));
  }
}

export function registerK8sJobTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "k8s_job",
    description:
      "Kubernetes Job operations: list, describe, status, logs, create, delete",
    schema: K8sJobSchema,
    handler: async (params: K8sJobParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleK8sJob(params, pluginConfig);
    },
  });
}
