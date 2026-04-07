import * as k8s from "@kubernetes/client-node";
import yaml from "js-yaml";
import { z } from "zod";
import { createK8sClients } from "../lib/client.js";
import { wrapK8sError } from "../lib/errors.js";
import type { PluginConfig } from "../lib/types.js";

export const K8sYamlSchema = z.object({
  action: z.enum(["export", "dry_run", "diff", "apply", "template"]),
  namespace: z.string().optional(),
  resource_type: z.string().optional(),
  resource_name: z.string().optional(),
  yaml_content: z.string().optional(),
  clean: z.boolean().optional(),
  template_type: z.string().optional(),
  template_params: z.record(z.string()).optional(),
  context: z.string().optional(),
});

export type K8sYamlParams = z.infer<typeof K8sYamlSchema>;

const FIELDS_TO_REMOVE = [
  "metadata.managedFields",
  "metadata.resourceVersion",
  "metadata.uid",
  "metadata.creationTimestamp",
  "metadata.generation",
  "metadata.selfLink",
  "status",
];

function cleanResource(obj: Record<string, unknown>): Record<string, unknown> {
  const cleaned = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;

  for (const path of FIELDS_TO_REMOVE) {
    const parts = path.split(".");
    let current: Record<string, unknown> = cleaned;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== "object") break;
      current = current[parts[i]] as Record<string, unknown>;
    }
    const lastKey = parts[parts.length - 1];
    if (lastKey in current) {
      delete current[lastKey];
    }
  }

  return cleaned;
}

function resourceApiPath(resourceType: string): { apiVersion: string; kind: string; plural: string } {
  const mapping: Record<string, { apiVersion: string; kind: string; plural: string }> = {
    pod: { apiVersion: "v1", kind: "Pod", plural: "pods" },
    service: { apiVersion: "v1", kind: "Service", plural: "services" },
    configmap: { apiVersion: "v1", kind: "ConfigMap", plural: "configmaps" },
    secret: { apiVersion: "v1", kind: "Secret", plural: "secrets" },
    deployment: { apiVersion: "apps/v1", kind: "Deployment", plural: "deployments" },
    statefulset: { apiVersion: "apps/v1", kind: "StatefulSet", plural: "statefulsets" },
    daemonset: { apiVersion: "apps/v1", kind: "DaemonSet", plural: "daemonsets" },
    job: { apiVersion: "batch/v1", kind: "Job", plural: "jobs" },
    cronjob: { apiVersion: "batch/v1", kind: "CronJob", plural: "cronjobs" },
    ingress: { apiVersion: "networking.k8s.io/v1", kind: "Ingress", plural: "ingresses" },
    namespace: { apiVersion: "v1", kind: "Namespace", plural: "namespaces" },
  };

  const lower = resourceType.toLowerCase();
  const found = mapping[lower];
  if (!found) {
    throw new Error(`Unknown resource type: ${resourceType}. Supported: ${Object.keys(mapping).join(", ")}`);
  }
  return found;
}

async function readResource(
  clients: ReturnType<typeof createK8sClients>,
  resourceType: string,
  name: string,
  namespace: string
): Promise<Record<string, unknown>> {
  const { apiVersion, kind } = resourceApiPath(resourceType);

  const spec: k8s.KubernetesObject = {
    apiVersion,
    kind,
    metadata: { name, namespace },
  };

  const response = await clients.objectApi.read(spec);
  return response.body as unknown as Record<string, unknown>;
}

function diffFields(
  prefix: string,
  live: Record<string, unknown>,
  target: Record<string, unknown>
): string[] {
  const changes: string[] = [];
  const allKeys = new Set([...Object.keys(live), ...Object.keys(target)]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const liveVal = live[key];
    const targetVal = target[key];

    if (!(key in live)) {
      changes.push(`+ ${path}: ${JSON.stringify(targetVal)}`);
    } else if (!(key in target)) {
      changes.push(`- ${path}: ${JSON.stringify(liveVal)}`);
    } else if (
      typeof liveVal === "object" &&
      liveVal !== null &&
      typeof targetVal === "object" &&
      targetVal !== null &&
      !Array.isArray(liveVal) &&
      !Array.isArray(targetVal)
    ) {
      changes.push(
        ...diffFields(
          path,
          liveVal as Record<string, unknown>,
          targetVal as Record<string, unknown>
        )
      );
    } else if (JSON.stringify(liveVal) !== JSON.stringify(targetVal)) {
      changes.push(`~ ${path}: ${JSON.stringify(liveVal)} → ${JSON.stringify(targetVal)}`);
    }
  }

  return changes;
}

type TemplateParams = Record<string, string>;

function generateTemplate(templateType: string, params: TemplateParams): string {
  const templates: Record<string, (p: TemplateParams) => Record<string, unknown>> = {
    deployment: (p) => ({
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name: p.name || "my-app",
        labels: { app: p.name || "my-app" },
      },
      spec: {
        replicas: parseInt(p.replicas || "1", 10),
        selector: { matchLabels: { app: p.name || "my-app" } },
        template: {
          metadata: { labels: { app: p.name || "my-app" } },
          spec: {
            containers: [
              {
                name: p.name || "my-app",
                image: p.image || "nginx:latest",
                ports: p.port ? [{ containerPort: parseInt(p.port, 10) }] : [],
              },
            ],
          },
        },
      },
    }),

    service: (p) => ({
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: p.name || "my-service" },
      spec: {
        type: p.type || "ClusterIP",
        selector: { app: p.selector || p.name || "my-app" },
        ports: [
          {
            port: parseInt(p.port || "80", 10),
            targetPort: parseInt(p.targetPort || p.port || "80", 10),
          },
        ],
      },
    }),

    ingress: (p) => ({
      apiVersion: "networking.k8s.io/v1",
      kind: "Ingress",
      metadata: {
        name: p.name || "my-ingress",
        ...(p.tls === "true" ? { annotations: { "cert-manager.io/cluster-issuer": "letsencrypt" } } : {}),
      },
      spec: {
        ...(p.tls === "true"
          ? { tls: [{ hosts: [p.host || "example.com"], secretName: `${p.name || "my-ingress"}-tls` }] }
          : {}),
        rules: [
          {
            host: p.host || "example.com",
            http: {
              paths: [
                {
                  path: p.path || "/",
                  pathType: "Prefix",
                  backend: {
                    service: {
                      name: p.serviceName || p.name || "my-service",
                      port: { number: parseInt(p.servicePort || "80", 10) },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    }),

    job: (p) => ({
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: p.name || "my-job" },
      spec: {
        template: {
          spec: {
            containers: [
              {
                name: p.name || "my-job",
                image: p.image || "busybox",
                command: p.command ? p.command.split(" ") : ["echo", "hello"],
              },
            ],
            restartPolicy: "Never",
          },
        },
        backoffLimit: 4,
      },
    }),

    cronjob: (p) => ({
      apiVersion: "batch/v1",
      kind: "CronJob",
      metadata: { name: p.name || "my-cronjob" },
      spec: {
        schedule: p.schedule || "0 * * * *",
        jobTemplate: {
          spec: {
            template: {
              spec: {
                containers: [
                  {
                    name: p.name || "my-cronjob",
                    image: p.image || "busybox",
                    command: p.command ? p.command.split(" ") : ["echo", "hello"],
                  },
                ],
                restartPolicy: "OnFailure",
              },
            },
          },
        },
      },
    }),

    configmap: (p) => {
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries(p)) {
        if (k !== "name") data[k] = v;
      }
      return {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: p.name || "my-configmap" },
        data: Object.keys(data).length > 0 ? data : { key: "value" },
      };
    },
  };

  const lower = templateType.toLowerCase();
  const generator = templates[lower];
  if (!generator) {
    throw new Error(`Unknown template type: ${templateType}. Supported: ${Object.keys(templates).join(", ")}`);
  }

  return yaml.dump(generator(params), { lineWidth: -1 });
}

export async function handleK8sYaml(
  params: K8sYamlParams,
  pluginConfig?: PluginConfig
): Promise<string> {
  try {
    switch (params.action) {
      case "template": {
        if (!params.template_type) {
          throw new Error("template_type is required for template action");
        }
        return generateTemplate(params.template_type, params.template_params || {});
      }

      case "export": {
        if (!params.resource_type || !params.resource_name) {
          throw new Error("resource_type and resource_name are required for export action");
        }
        const clients = createK8sClients(pluginConfig, params.context);
        const namespace = params.namespace || "default";

        const resource = await readResource(clients, params.resource_type, params.resource_name, namespace);
        const shouldClean = params.clean !== false;
        const output = shouldClean ? cleanResource(resource) : resource;

        return yaml.dump(output, { lineWidth: -1 });
      }

      case "dry_run": {
        if (!params.yaml_content) {
          throw new Error("yaml_content is required for dry_run action");
        }
        const clients = createK8sClients(pluginConfig, params.context);
        const spec = yaml.load(params.yaml_content) as k8s.KubernetesObject;

        if (!spec || !spec.kind || !spec.apiVersion) {
          throw new Error("Invalid YAML: must contain apiVersion and kind");
        }

        if (!spec.metadata) {
          spec.metadata = {};
        }
        if (!spec.metadata.namespace && params.namespace) {
          spec.metadata.namespace = params.namespace;
        }

        await clients.objectApi.create(spec, undefined, "All");
        return `Dry-run validation passed for ${spec.kind}/${spec.metadata?.name || "unknown"}`;
      }

      case "diff": {
        if (!params.yaml_content) {
          throw new Error("yaml_content is required for diff action");
        }
        if (!params.resource_type || !params.resource_name) {
          throw new Error("resource_type and resource_name are required for diff action");
        }
        const clients = createK8sClients(pluginConfig, params.context);
        const namespace = params.namespace || "default";

        const live = await readResource(clients, params.resource_type, params.resource_name, namespace);
        const target = yaml.load(params.yaml_content) as Record<string, unknown>;

        const cleanedLive = cleanResource(live);
        const changes = diffFields("", cleanedLive, target);

        if (changes.length === 0) {
          return `No differences found between live ${params.resource_type}/${params.resource_name} and provided YAML.`;
        }

        const header = `Diff: live ${params.resource_type}/${params.resource_name} vs provided YAML`;
        return [header, ...changes].join("\n");
      }

      case "apply": {
        if (!params.yaml_content) {
          throw new Error("yaml_content is required for apply action");
        }
        const clients = createK8sClients(pluginConfig, params.context);
        const spec = yaml.load(params.yaml_content) as k8s.KubernetesObject;

        if (!spec || !spec.kind || !spec.apiVersion) {
          throw new Error("Invalid YAML: must contain apiVersion and kind");
        }

        if (!spec.metadata) {
          spec.metadata = {};
        }
        if (!spec.metadata.namespace && params.namespace) {
          spec.metadata.namespace = params.namespace;
        }

        const headers = { "Content-Type": "application/apply-patch+yaml" };
        await clients.objectApi.patch(
          spec,
          undefined,
          undefined,
          "k8s-ops-agent",
          true,
          { headers }
        );

        return `Applied ${spec.kind}/${spec.metadata?.name || "unknown"} via server-side apply`;
      }

      default:
        throw new Error(`Unknown action: ${params.action}`);
    }
  } catch (error: unknown) {
    throw new Error(wrapK8sError(error, `yaml ${params.action}`));
  }
}

