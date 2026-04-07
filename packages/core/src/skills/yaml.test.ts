import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sYamlSchema } from "./yaml.js";

const mockObjectApiRead = vi.fn();
const mockObjectApiCreate = vi.fn();
const mockObjectApiPatch = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    objectApi: {
      read: mockObjectApiRead,
      create: mockObjectApiCreate,
      patch: mockObjectApiPatch,
    },
  }),
}));

const { handleK8sYaml } = await import("./yaml.js");

describe("K8sYamlSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sYamlSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["export", "dry_run", "diff", "apply", "template"];
    for (const action of actions) {
      const result = K8sYamlSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sYaml export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports resource and removes managed fields", async () => {
    mockObjectApiRead.mockResolvedValue({
      body: {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "web",
          namespace: "default",
          uid: "abc-123",
          resourceVersion: "12345",
          creationTimestamp: "2026-01-01T00:00:00Z",
          generation: 5,
          managedFields: [{ manager: "kubectl" }],
        },
        spec: { replicas: 3 },
        status: { readyReplicas: 3 },
      },
    });

    const result = await handleK8sYaml({
      action: "export",
      resource_type: "deployment",
      resource_name: "web",
    });
    expect(result).toContain("kind: Deployment");
    expect(result).toContain("replicas: 3");
    expect(result).not.toContain("managedFields");
    expect(result).not.toContain("resourceVersion");
    expect(result).not.toContain("uid");
    expect(result).not.toContain("readyReplicas");
  });

  it("exports without cleaning when clean=false", async () => {
    mockObjectApiRead.mockResolvedValue({
      body: {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: "svc",
          namespace: "default",
          uid: "xyz-789",
          resourceVersion: "555",
        },
        spec: { type: "ClusterIP" },
        status: { loadBalancer: {} },
      },
    });

    const result = await handleK8sYaml({
      action: "export",
      resource_type: "service",
      resource_name: "svc",
      clean: false,
    });
    expect(result).toContain("uid");
    expect(result).toContain("resourceVersion");
  });

  it("requires resource_type and resource_name", async () => {
    await expect(
      handleK8sYaml({ action: "export" })
    ).rejects.toThrow("resource_type and resource_name are required");
  });
});

describe("handleK8sYaml dry_run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates correct YAML", async () => {
    mockObjectApiCreate.mockResolvedValue({});

    const yamlContent = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test
spec:
  replicas: 1
`;
    const result = await handleK8sYaml({
      action: "dry_run",
      yaml_content: yamlContent,
    });
    expect(result).toContain("Dry-run validation passed");
    expect(result).toContain("Deployment");
    expect(mockObjectApiCreate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "Deployment" }),
      undefined,
      "All"
    );
  });

  it("rejects invalid YAML without kind", async () => {
    await expect(
      handleK8sYaml({
        action: "dry_run",
        yaml_content: "foo: bar",
      })
    ).rejects.toThrow("Invalid YAML");
  });

  it("requires yaml_content", async () => {
    await expect(
      handleK8sYaml({ action: "dry_run" })
    ).rejects.toThrow("yaml_content is required");
  });
});

describe("handleK8sYaml diff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows field-level differences", async () => {
    mockObjectApiRead.mockResolvedValue({
      body: {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "web",
          namespace: "default",
          uid: "abc",
          resourceVersion: "100",
          managedFields: [],
        },
        spec: { replicas: 3 },
        status: {},
      },
    });

    const targetYaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 5
`;
    const result = await handleK8sYaml({
      action: "diff",
      resource_type: "deployment",
      resource_name: "web",
      yaml_content: targetYaml,
    });
    expect(result).toContain("Diff:");
    expect(result).toContain("replicas");
  });

  it("reports no differences", async () => {
    mockObjectApiRead.mockResolvedValue({
      body: {
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { name: "cfg", namespace: "default" },
        data: { key: "val" },
      },
    });

    const targetYaml = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: cfg
  namespace: default
data:
  key: val
`;
    const result = await handleK8sYaml({
      action: "diff",
      resource_type: "configmap",
      resource_name: "cfg",
      yaml_content: targetYaml,
    });
    expect(result).toContain("No differences found");
  });

  it("requires yaml_content and resource info", async () => {
    await expect(
      handleK8sYaml({ action: "diff" })
    ).rejects.toThrow("yaml_content is required");

    await expect(
      handleK8sYaml({ action: "diff", yaml_content: "foo: bar" })
    ).rejects.toThrow("resource_type and resource_name are required");
  });
});

describe("handleK8sYaml apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies YAML via server-side apply", async () => {
    mockObjectApiPatch.mockResolvedValue({});

    const yamlContent = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 5
`;
    const result = await handleK8sYaml({
      action: "apply",
      yaml_content: yamlContent,
      namespace: "production",
    });
    expect(result).toContain("Applied");
    expect(result).toContain("Deployment/web");
    expect(mockObjectApiPatch).toHaveBeenCalled();
  });

  it("rejects invalid YAML", async () => {
    await expect(
      handleK8sYaml({ action: "apply", yaml_content: "foo: bar" })
    ).rejects.toThrow("Invalid YAML");
  });

  it("requires yaml_content", async () => {
    await expect(
      handleK8sYaml({ action: "apply" })
    ).rejects.toThrow("yaml_content is required");
  });
});

describe("handleK8sYaml template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates deployment YAML", async () => {
    const result = await handleK8sYaml({
      action: "template",
      template_type: "deployment",
      template_params: { name: "web", image: "nginx:1.25", replicas: "3", port: "80" },
    });
    expect(result).toContain("kind: Deployment");
    expect(result).toContain("name: web");
    expect(result).toContain("nginx:1.25");
    expect(result).toContain("replicas: 3");
    expect(result).toContain("containerPort: 80");
  });

  it("generates service YAML", async () => {
    const result = await handleK8sYaml({
      action: "template",
      template_type: "service",
      template_params: { name: "web-svc", port: "8080", type: "NodePort" },
    });
    expect(result).toContain("kind: Service");
    expect(result).toContain("name: web-svc");
    expect(result).toContain("type: NodePort");
    expect(result).toContain("port: 8080");
  });

  it("generates ingress YAML with TLS", async () => {
    const result = await handleK8sYaml({
      action: "template",
      template_type: "ingress",
      template_params: { name: "api", host: "api.example.com", tls: "true" },
    });
    expect(result).toContain("kind: Ingress");
    expect(result).toContain("api.example.com");
    expect(result).toContain("tls");
    expect(result).toContain("api-tls");
  });

  it("generates job YAML", async () => {
    const result = await handleK8sYaml({
      action: "template",
      template_type: "job",
      template_params: { name: "migrate", image: "app:v1", command: "npm run migrate" },
    });
    expect(result).toContain("kind: Job");
    expect(result).toContain("name: migrate");
    expect(result).toContain("app:v1");
    expect(result).toContain("restartPolicy: Never");
  });

  it("generates cronjob YAML", async () => {
    const result = await handleK8sYaml({
      action: "template",
      template_type: "cronjob",
      template_params: { name: "backup", schedule: "0 2 * * *", image: "backup:latest" },
    });
    expect(result).toContain("kind: CronJob");
    expect(result).toContain("0 2 * * *");
    expect(result).toContain("backup:latest");
  });

  it("generates configmap YAML", async () => {
    const result = await handleK8sYaml({
      action: "template",
      template_type: "configmap",
      template_params: { name: "app-config", DB_HOST: "postgres", DB_PORT: "5432" },
    });
    expect(result).toContain("kind: ConfigMap");
    expect(result).toContain("DB_HOST: postgres");
    expect(result).toContain("DB_PORT: '5432'");
  });

  it("requires template_type", async () => {
    await expect(
      handleK8sYaml({ action: "template" })
    ).rejects.toThrow("template_type is required");
  });

  it("rejects unknown template type", async () => {
    await expect(
      handleK8sYaml({ action: "template", template_type: "unknown" })
    ).rejects.toThrow("Unknown template type");
  });
});
