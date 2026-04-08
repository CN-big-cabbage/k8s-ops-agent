import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sCostSchema, parseCpuValue, parseMemoryValue } from "./cost.js";

const mockListNamespacedCustomObject = vi.fn();
const mockListClusterCustomObject = vi.fn();
const mockListDeploymentForAllNamespaces = vi.fn();
const mockListNamespacedDeployment = vi.fn();
const mockListStatefulSetForAllNamespaces = vi.fn();
const mockListNamespacedStatefulSet = vi.fn();
const mockListPodForAllNamespaces = vi.fn();
const mockListNamespacedPod = vi.fn();
const mockListJobForAllNamespaces = vi.fn();
const mockListNamespacedJob = vi.fn();
const mockListServiceForAllNamespaces = vi.fn();
const mockListNamespacedService = vi.fn();
const mockListEndpointsForAllNamespaces = vi.fn();
const mockListNamespacedEndpoints = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    customObjectsApi: {
      listNamespacedCustomObject: mockListNamespacedCustomObject,
      listClusterCustomObject: mockListClusterCustomObject,
    },
    appsApi: {
      listDeploymentForAllNamespaces: mockListDeploymentForAllNamespaces,
      listNamespacedDeployment: mockListNamespacedDeployment,
      listStatefulSetForAllNamespaces: mockListStatefulSetForAllNamespaces,
      listNamespacedStatefulSet: mockListNamespacedStatefulSet,
    },
    coreApi: {
      listPodForAllNamespaces: mockListPodForAllNamespaces,
      listNamespacedPod: mockListNamespacedPod,
      listServiceForAllNamespaces: mockListServiceForAllNamespaces,
      listNamespacedService: mockListNamespacedService,
      listEndpointsForAllNamespaces: mockListEndpointsForAllNamespaces,
      listNamespacedEndpoints: mockListNamespacedEndpoints,
    },
    batchApi: {
      listJobForAllNamespaces: mockListJobForAllNamespaces,
      listNamespacedJob: mockListNamespacedJob,
    },
  }),
}));

const { handleK8sCost } = await import("./cost.js");

function setupBasicMocks() {
  mockListNamespacedCustomObject.mockResolvedValue({
    body: {
      items: [
        {
          metadata: { name: "web-abc-1", namespace: "default" },
          containers: [{ name: "web", usage: { cpu: "850m", memory: "256Mi" } }],
        },
      ],
    },
  });

  mockListNamespacedDeployment.mockResolvedValue({
    body: {
      items: [
        {
          metadata: { name: "web", namespace: "default" },
          spec: {
            replicas: 1,
            selector: { matchLabels: { app: "web" } },
          },
        },
      ],
    },
  });

  mockListNamespacedStatefulSet.mockResolvedValue({ body: { items: [] } });

  mockListNamespacedPod.mockResolvedValue({
    body: {
      items: [
        {
          metadata: { name: "web-abc-1", namespace: "default", labels: { app: "web" } },
          spec: {
            containers: [
              {
                name: "web",
                resources: {
                  requests: { cpu: "2000m", memory: "512Mi" },
                  limits: { cpu: "4000m", memory: "1Gi" },
                },
              },
            ],
          },
        },
      ],
    },
  });
}

describe("parseCpuValue", () => {
  it("parses millicpu", () => {
    expect(parseCpuValue("500m")).toBe(500);
  });

  it("parses nanocpu", () => {
    expect(parseCpuValue("1000000n")).toBe(1);
  });

  it("parses whole cores", () => {
    expect(parseCpuValue("2")).toBe(2000);
  });
});

describe("parseMemoryValue", () => {
  it("parses Mi", () => {
    expect(parseMemoryValue("256Mi")).toBe(256 * 1024 * 1024);
  });

  it("parses Gi", () => {
    expect(parseMemoryValue("1Gi")).toBe(1024 * 1024 * 1024);
  });

  it("parses Ki", () => {
    expect(parseMemoryValue("1024Ki")).toBe(1024 * 1024);
  });
});

describe("K8sCostSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sCostSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["namespace_usage", "overprovisioned", "underprovisioned", "idle_resources", "recommendations"];
    for (const action of actions) {
      const result = K8sCostSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sCost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("namespace_usage calculates efficiency correctly", async () => {
    setupBasicMocks();

    const result = await handleK8sCost({ action: "namespace_usage", namespace: "default" });
    expect(result).toContain("Deployment/web");
    expect(result).toContain("2000m");
    expect(result).toContain("850m");
    expect(result).toContain("42.5%");
    expect(result).toContain("efficiency");
  });

  it("namespace_usage returns empty message", async () => {
    mockListNamespacedCustomObject.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedDeployment.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedStatefulSet.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedPod.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sCost({ action: "namespace_usage", namespace: "default" });
    expect(result).toContain("No workloads found");
  });

  it("overprovisioned flags resources above threshold", async () => {
    setupBasicMocks();

    const result = await handleK8sCost({
      action: "overprovisioned",
      namespace: "default",
      threshold: 50,
    });
    expect(result).toContain("Deployment/web");
    expect(result).toContain("OVER");
  });

  it("overprovisioned returns empty when all efficient", async () => {
    mockListNamespacedCustomObject.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-abc-1", namespace: "default" },
            containers: [{ name: "web", usage: { cpu: "900m", memory: "256Mi" } }],
          },
        ],
      },
    });
    mockListNamespacedDeployment.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web", namespace: "default" },
            spec: { replicas: 1, selector: { matchLabels: { app: "web" } } },
          },
        ],
      },
    });
    mockListNamespacedStatefulSet.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-abc-1", namespace: "default", labels: { app: "web" } },
            spec: {
              containers: [
                { name: "web", resources: { requests: { cpu: "1000m" }, limits: { cpu: "2000m" } } },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sCost({
      action: "overprovisioned",
      namespace: "default",
      threshold: 50,
    });
    expect(result).toContain("No overprovisioned workloads found");
  });

  it("underprovisioned flags resources above threshold", async () => {
    mockListNamespacedCustomObject.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "api-abc-1", namespace: "default" },
            containers: [{ name: "api", usage: { cpu: "1800m", memory: "256Mi" } }],
          },
        ],
      },
    });
    mockListNamespacedDeployment.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "api", namespace: "default" },
            spec: { replicas: 1, selector: { matchLabels: { app: "api" } } },
          },
        ],
      },
    });
    mockListNamespacedStatefulSet.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "api-abc-1", namespace: "default", labels: { app: "api" } },
            spec: {
              containers: [
                { name: "api", resources: { requests: { cpu: "500m" }, limits: { cpu: "1000m" } } },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sCost({
      action: "underprovisioned",
      namespace: "default",
      threshold: 50,
    });
    expect(result).toContain("api");
    expect(result).toContain("UNDER");
  });

  it("idle_resources finds zero-replica deployments", async () => {
    mockListNamespacedDeployment.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "old-app", namespace: "default" },
            spec: { replicas: 0 },
          },
        ],
      },
    });
    mockListNamespacedJob.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedService.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedEndpoints.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sCost({ action: "idle_resources", namespace: "default" });
    expect(result).toContain("IDLE");
    expect(result).toContain("old-app");
    expect(result).toContain("0 replicas");
  });

  it("idle_resources finds completed old jobs", async () => {
    const pastDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    mockListNamespacedDeployment.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedJob.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "migration-job", namespace: "default" },
            status: { succeeded: 1, completionTime: pastDate },
          },
        ],
      },
    });
    mockListNamespacedService.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedEndpoints.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sCost({ action: "idle_resources", namespace: "default" });
    expect(result).toContain("IDLE");
    expect(result).toContain("migration-job");
    expect(result).toContain("completed");
  });

  it("idle_resources returns empty when nothing idle", async () => {
    mockListNamespacedDeployment.mockResolvedValue({
      body: { items: [{ metadata: { name: "web" }, spec: { replicas: 3 } }] },
    });
    mockListNamespacedJob.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedService.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedEndpoints.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sCost({ action: "idle_resources", namespace: "default" });
    expect(result).toContain("No idle resources found");
  });

  it("recommendations produces actionable suggestions", async () => {
    setupBasicMocks();

    const result = await handleK8sCost({ action: "recommendations", namespace: "default" });
    expect(result).toContain("Recommendations");
    expect(result).toContain("SAVE");
    expect(result).toContain("reduce CPU request");
  });

  it("recommendations warns when CPU is high", async () => {
    mockListNamespacedCustomObject.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "api-abc-1", namespace: "default" },
            containers: [{ name: "api", usage: { cpu: "950m", memory: "256Mi" } }],
          },
        ],
      },
    });
    mockListNamespacedDeployment.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "api", namespace: "default" },
            spec: { replicas: 1, selector: { matchLabels: { app: "api" } } },
          },
        ],
      },
    });
    mockListNamespacedStatefulSet.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "api-abc-1", namespace: "default", labels: { app: "api" } },
            spec: {
              containers: [
                { name: "api", resources: { requests: { cpu: "1000m" }, limits: { cpu: "2000m" } } },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sCost({ action: "recommendations", namespace: "default" });
    expect(result).toContain("WARN");
    expect(result).toContain("consider increasing");
  });
});
