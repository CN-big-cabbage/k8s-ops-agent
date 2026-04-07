import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sHealthSchema, parseCertExpiry } from "./health.js";

const mockListNode = vi.fn();
const mockListDeploymentForAllNamespaces = vi.fn();
const mockListNamespacedDeployment = vi.fn();
const mockListStatefulSetForAllNamespaces = vi.fn();
const mockListNamespacedStatefulSet = vi.fn();
const mockListPodForAllNamespaces = vi.fn();
const mockListNamespacedPod = vi.fn();
const mockListServiceForAllNamespaces = vi.fn();
const mockListNamespacedService = vi.fn();
const mockListEndpointsForAllNamespaces = vi.fn();
const mockListNamespacedEndpoints = vi.fn();
const mockListIngressForAllNamespaces = vi.fn();
const mockListNamespacedIngress = vi.fn();
const mockListPersistentVolumeClaimForAllNamespaces = vi.fn();
const mockListPersistentVolume = vi.fn();
const mockListSecretForAllNamespaces = vi.fn();
const mockListNamespacedSecret = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    coreApi: {
      listNode: mockListNode,
      listPodForAllNamespaces: mockListPodForAllNamespaces,
      listNamespacedPod: mockListNamespacedPod,
      listServiceForAllNamespaces: mockListServiceForAllNamespaces,
      listNamespacedService: mockListNamespacedService,
      listEndpointsForAllNamespaces: mockListEndpointsForAllNamespaces,
      listNamespacedEndpoints: mockListNamespacedEndpoints,
      listPersistentVolumeClaimForAllNamespaces: mockListPersistentVolumeClaimForAllNamespaces,
      listPersistentVolume: mockListPersistentVolume,
      listSecretForAllNamespaces: mockListSecretForAllNamespaces,
      listNamespacedSecret: mockListNamespacedSecret,
    },
    appsApi: {
      listDeploymentForAllNamespaces: mockListDeploymentForAllNamespaces,
      listNamespacedDeployment: mockListNamespacedDeployment,
      listStatefulSetForAllNamespaces: mockListStatefulSetForAllNamespaces,
      listNamespacedStatefulSet: mockListNamespacedStatefulSet,
    },
    networkingApi: {
      listIngressForAllNamespaces: mockListIngressForAllNamespaces,
      listNamespacedIngress: mockListNamespacedIngress,
    },
  }),
}));

const { handleK8sHealth } = await import("./health.js");

function setupHealthyCluster() {
  mockListNode.mockResolvedValue({
    body: {
      items: [
        {
          metadata: { name: "node-1" },
          spec: {},
          status: {
            conditions: [
              { type: "Ready", status: "True" },
              { type: "MemoryPressure", status: "False" },
              { type: "DiskPressure", status: "False" },
            ],
          },
        },
      ],
    },
  });

  mockListDeploymentForAllNamespaces.mockResolvedValue({
    body: {
      items: [
        {
          metadata: { name: "web", namespace: "default" },
          spec: { replicas: 3 },
          status: { readyReplicas: 3 },
        },
      ],
    },
  });

  mockListStatefulSetForAllNamespaces.mockResolvedValue({ body: { items: [] } });
  mockListPodForAllNamespaces.mockResolvedValue({ body: { items: [] } });

  mockListServiceForAllNamespaces.mockResolvedValue({
    body: {
      items: [
        {
          metadata: { name: "web-svc", namespace: "default" },
          spec: { type: "ClusterIP", selector: { app: "web" } },
        },
      ],
    },
  });

  mockListEndpointsForAllNamespaces.mockResolvedValue({
    body: {
      items: [
        {
          metadata: { name: "web-svc", namespace: "default" },
          subsets: [{ addresses: [{ ip: "10.0.0.1" }] }],
        },
      ],
    },
  });

  mockListIngressForAllNamespaces.mockResolvedValue({ body: { items: [] } });
  mockListPersistentVolumeClaimForAllNamespaces.mockResolvedValue({ body: { items: [] } });
  mockListPersistentVolume.mockResolvedValue({ body: { items: [] } });
  mockListSecretForAllNamespaces.mockResolvedValue({ body: { items: [] } });
}

describe("K8sHealthSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sHealthSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["cluster", "nodes", "workloads", "networking", "storage", "certificates"];
    for (const action of actions) {
      const result = K8sHealthSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cluster returns scored report with all checks", async () => {
    setupHealthyCluster();

    const result = await handleK8sHealth({ action: "cluster" });
    expect(result).toContain("Cluster Health Report");
    expect(result).toContain("Overall Score:");
    expect(result).toContain("Nodes");
    expect(result).toContain("Workloads");
    expect(result).toContain("Network");
    expect(result).toContain("Storage");
    expect(result).toContain("Certs");
  });

  it("cluster reports 100/100 for healthy cluster", async () => {
    setupHealthyCluster();

    const result = await handleK8sHealth({ action: "cluster" });
    expect(result).toContain("Overall Score: 100/100");
  });

  it("nodes detects NotReady node", async () => {
    mockListNode.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "node-1" },
            spec: {},
            status: { conditions: [{ type: "Ready", status: "False" }] },
          },
        ],
      },
    });

    const result = await handleK8sHealth({ action: "nodes" });
    expect(result).toContain("CRIT");
    expect(result).toContain("node-1: NotReady");
  });

  it("nodes detects memory pressure", async () => {
    mockListNode.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "node-3" },
            spec: {},
            status: {
              conditions: [
                { type: "Ready", status: "True" },
                { type: "MemoryPressure", status: "True" },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sHealth({ action: "nodes" });
    expect(result).toContain("WARN");
    expect(result).toContain("node-3: MemoryPressure=True");
  });

  it("nodes detects cordoned node", async () => {
    mockListNode.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "node-5" },
            spec: { unschedulable: true },
            status: { conditions: [{ type: "Ready", status: "True" }] },
          },
        ],
      },
    });

    const result = await handleK8sHealth({ action: "nodes" });
    expect(result).toContain("WARN");
    expect(result).toContain("node-5: cordoned");
  });

  it("workloads detects unhealthy deployment", async () => {
    mockListNamespacedDeployment.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "api-server", namespace: "default" },
            spec: { replicas: 3 },
            status: { readyReplicas: 0 },
          },
        ],
      },
    });
    mockListNamespacedStatefulSet.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedPod.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sHealth({ action: "workloads", namespace: "default" });
    expect(result).toContain("CRIT");
    expect(result).toContain("default/api-server: 0/3 replicas ready");
  });

  it("workloads detects CrashLoopBackOff pod", async () => {
    mockListNamespacedDeployment.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedStatefulSet.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "api-abc-123", namespace: "default" },
            status: {
              containerStatuses: [
                { name: "api", state: { waiting: { reason: "CrashLoopBackOff" } } },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sHealth({ action: "workloads", namespace: "default" });
    expect(result).toContain("CRIT");
    expect(result).toContain("CrashLoopBackOff");
  });

  it("networking detects service with no endpoints", async () => {
    mockListNamespacedService.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "orphan-svc", namespace: "default" },
            spec: { type: "ClusterIP", selector: { app: "gone" } },
          },
        ],
      },
    });
    mockListNamespacedEndpoints.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "orphan-svc", namespace: "default" },
            subsets: [],
          },
        ],
      },
    });
    mockListNamespacedIngress.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sHealth({ action: "networking", namespace: "default" });
    expect(result).toContain("WARN");
    expect(result).toContain("orphan-svc: no ready endpoints");
  });

  it("storage detects unbound PVC", async () => {
    mockListPersistentVolumeClaimForAllNamespaces.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "data-0", namespace: "default" },
            status: { phase: "Pending" },
          },
        ],
      },
    });
    mockListPersistentVolume.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sHealth({ action: "storage" });
    expect(result).toContain("WARN");
    expect(result).toContain("default/data-0: Pending (not Bound)");
  });

  it("storage detects released PV", async () => {
    mockListPersistentVolumeClaimForAllNamespaces.mockResolvedValue({ body: { items: [] } });
    mockListPersistentVolume.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "old-backup" },
            status: { phase: "Released" },
          },
        ],
      },
    });

    const result = await handleK8sHealth({ action: "storage" });
    expect(result).toContain("INFO");
    expect(result).toContain("old-backup: Released, not reclaimed");
  });

  it("certificates returns clean result when no TLS secrets", async () => {
    mockListNamespacedSecret.mockResolvedValue({
      body: { items: [] },
    });

    const result = await handleK8sHealth({ action: "certificates", namespace: "default" });
    expect(result).toContain("Certs");
    expect(result).toContain("0 issues");
  });

  it("cluster aggregates sub-check scores correctly", async () => {
    mockListNode.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "node-1" },
            spec: {},
            status: { conditions: [{ type: "Ready", status: "False" }] },
          },
        ],
      },
    });
    mockListDeploymentForAllNamespaces.mockResolvedValue({ body: { items: [] } });
    mockListStatefulSetForAllNamespaces.mockResolvedValue({ body: { items: [] } });
    mockListPodForAllNamespaces.mockResolvedValue({ body: { items: [] } });
    mockListServiceForAllNamespaces.mockResolvedValue({ body: { items: [] } });
    mockListEndpointsForAllNamespaces.mockResolvedValue({ body: { items: [] } });
    mockListIngressForAllNamespaces.mockResolvedValue({ body: { items: [] } });
    mockListPersistentVolumeClaimForAllNamespaces.mockResolvedValue({ body: { items: [] } });
    mockListPersistentVolume.mockResolvedValue({ body: { items: [] } });
    mockListSecretForAllNamespaces.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sHealth({ action: "cluster" });
    expect(result).toContain("Cluster Health Report");
    expect(result).not.toContain("Overall Score: 100/100");
  });
});

describe("parseCertExpiry", () => {
  it("returns null for invalid cert data", () => {
    const result = parseCertExpiry("bm90LWEtY2VydA=="); // "not-a-cert" in base64
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = parseCertExpiry("");
    expect(result).toBeNull();
  });
});
