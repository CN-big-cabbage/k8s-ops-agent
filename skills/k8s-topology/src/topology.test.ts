import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sTopologySchema } from "./topology.js";

const mockReadNamespacedService = vi.fn();
const mockReadNamespacedEndpoints = vi.fn();
const mockReadNamespacedPod = vi.fn();
const mockReadNamespacedDeployment = vi.fn();
const mockReadNamespacedStatefulSet = vi.fn();
const mockReadNamespacedDaemonSet = vi.fn();
const mockListNamespacedReplicaSet = vi.fn();
const mockListNamespacedPod = vi.fn();
const mockListNamespacedDeployment = vi.fn();
const mockListNamespacedStatefulSet = vi.fn();
const mockListNamespacedDaemonSet = vi.fn();
const mockListNamespacedService = vi.fn();
const mockListNamespacedIngress = vi.fn();
const mockListNamespacedConfigMap = vi.fn();
const mockListNamespacedSecret = vi.fn();
const mockListNamespacedPersistentVolumeClaim = vi.fn();

vi.mock("../../../lib/client.js", () => ({
  createK8sClients: () => ({
    coreApi: {
      readNamespacedService: mockReadNamespacedService,
      readNamespacedEndpoints: mockReadNamespacedEndpoints,
      readNamespacedPod: mockReadNamespacedPod,
      listNamespacedPod: mockListNamespacedPod,
      listNamespacedService: mockListNamespacedService,
      listNamespacedConfigMap: mockListNamespacedConfigMap,
      listNamespacedSecret: mockListNamespacedSecret,
      listNamespacedPersistentVolumeClaim: mockListNamespacedPersistentVolumeClaim,
    },
    appsApi: {
      readNamespacedDeployment: mockReadNamespacedDeployment,
      readNamespacedStatefulSet: mockReadNamespacedStatefulSet,
      readNamespacedDaemonSet: mockReadNamespacedDaemonSet,
      listNamespacedReplicaSet: mockListNamespacedReplicaSet,
      listNamespacedDeployment: mockListNamespacedDeployment,
      listNamespacedStatefulSet: mockListNamespacedStatefulSet,
      listNamespacedDaemonSet: mockListNamespacedDaemonSet,
    },
    networkingApi: {
      listNamespacedIngress: mockListNamespacedIngress,
    },
  }),
}));

const { handleK8sTopology } = await import("./topology.js");

describe("K8sTopologySchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sTopologySchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["service_chain", "workload_chain", "pod_dependencies", "namespace_map"];
    for (const action of actions) {
      const result = K8sTopologySchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sTopology", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("service_chain builds tree from service to pods", async () => {
    mockReadNamespacedService.mockResolvedValue({
      body: {
        metadata: { name: "web-svc", namespace: "default" },
        spec: { type: "ClusterIP", clusterIP: "10.96.0.100", selector: { app: "web" } },
      },
    });
    mockReadNamespacedEndpoints.mockResolvedValue({
      body: {
        subsets: [
          {
            addresses: [
              { ip: "10.244.1.5", targetRef: { kind: "Pod", name: "web-abc-1234", namespace: "default" } },
              { ip: "10.244.2.8", targetRef: { kind: "Pod", name: "web-abc-5678", namespace: "default" } },
            ],
            ports: [{ port: 8080 }],
          },
        ],
      },
    });
    mockReadNamespacedPod
      .mockResolvedValueOnce({
        body: {
          metadata: { name: "web-abc-1234" },
          status: { phase: "Running" },
          spec: { nodeName: "node-1" },
        },
      })
      .mockResolvedValueOnce({
        body: {
          metadata: { name: "web-abc-5678" },
          status: { phase: "Running" },
          spec: { nodeName: "node-2" },
        },
      });

    const result = await handleK8sTopology({ action: "service_chain", name: "web-svc" });
    expect(result).toContain("Service: default/web-svc");
    expect(result).toContain("ClusterIP: 10.96.0.100");
    expect(result).toContain("10.244.1.5:8080");
    expect(result).toContain("web-abc-1234 (Running) [node-1]");
    expect(result).toContain("web-abc-5678 (Running) [node-2]");
  });

  it("service_chain shows no endpoints", async () => {
    mockReadNamespacedService.mockResolvedValue({
      body: {
        metadata: { name: "orphan-svc", namespace: "default" },
        spec: { type: "ClusterIP", clusterIP: "10.96.0.50" },
      },
    });
    mockReadNamespacedEndpoints.mockResolvedValue({
      body: { subsets: [] },
    });

    const result = await handleK8sTopology({ action: "service_chain", name: "orphan-svc" });
    expect(result).toContain("no endpoints");
  });

  it("service_chain requires name", async () => {
    await expect(
      handleK8sTopology({ action: "service_chain" })
    ).rejects.toThrow("name is required");
  });

  it("workload_chain handles Deployment with ReplicaSet and Pods", async () => {
    mockReadNamespacedDeployment.mockResolvedValue({
      body: {
        metadata: { name: "web", namespace: "default" },
        spec: { replicas: 2, selector: { matchLabels: { app: "web" } } },
        status: { readyReplicas: 2 },
      },
    });
    mockListNamespacedReplicaSet.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-abc" },
            status: { replicas: 2, readyReplicas: 2 },
          },
        ],
      },
    });
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-abc-1234", ownerReferences: [{ name: "web-abc", kind: "ReplicaSet" }] },
            status: { phase: "Running" },
            spec: { nodeName: "node-1" },
          },
          {
            metadata: { name: "web-abc-5678", ownerReferences: [{ name: "web-abc", kind: "ReplicaSet" }] },
            status: { phase: "Running" },
            spec: { nodeName: "node-2" },
          },
        ],
      },
    });

    const result = await handleK8sTopology({ action: "workload_chain", name: "web" });
    expect(result).toContain("Deployment: default/web (2/2 ready)");
    expect(result).toContain("ReplicaSet: web-abc");
    expect(result).toContain("web-abc-1234 (Running) [node-1]");
    expect(result).toContain("web-abc-5678 (Running) [node-2]");
  });

  it("workload_chain falls back to StatefulSet", async () => {
    mockReadNamespacedDeployment.mockRejectedValue(new Error("not found"));
    mockReadNamespacedStatefulSet.mockResolvedValue({
      body: {
        metadata: { name: "db", namespace: "default" },
        spec: { replicas: 3, selector: { matchLabels: { app: "db" } } },
        status: { readyReplicas: 3 },
      },
    });
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "db-0" },
            status: { phase: "Running" },
            spec: { nodeName: "node-1" },
          },
        ],
      },
    });

    const result = await handleK8sTopology({ action: "workload_chain", name: "db" });
    expect(result).toContain("StatefulSet: default/db");
    expect(result).toContain("db-0 (Running) [node-1]");
  });

  it("workload_chain requires name", async () => {
    await expect(
      handleK8sTopology({ action: "workload_chain" })
    ).rejects.toThrow("name is required");
  });

  it("pod_dependencies finds mounted volumes and envFrom", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        metadata: { name: "web-abc-1234", namespace: "default" },
        status: { phase: "Running" },
        spec: {
          nodeName: "node-1",
          serviceAccountName: "web-sa",
          containers: [
            {
              name: "web",
              envFrom: [{ configMapRef: { name: "web-env" } }],
              env: [
                { name: "DB_PASS", valueFrom: { secretKeyRef: { name: "db-secret", key: "password" } } },
              ],
            },
          ],
          volumes: [
            { name: "config", configMap: { name: "web-config" } },
            { name: "tls", secret: { secretName: "web-tls" } },
            { name: "data", persistentVolumeClaim: { claimName: "web-data" } },
          ],
        },
      },
    });

    const result = await handleK8sTopology({ action: "pod_dependencies", pod_name: "web-abc-1234" });
    expect(result).toContain("Pod: default/web-abc-1234");
    expect(result).toContain("ConfigMap");
    expect(result).toContain("web-config");
    expect(result).toContain("web-env");
    expect(result).toContain("Secret");
    expect(result).toContain("web-tls");
    expect(result).toContain("db-secret");
    expect(result).toContain("PVC");
    expect(result).toContain("web-data");
    expect(result).toContain("ServiceAccount");
    expect(result).toContain("web-sa");
  });

  it("pod_dependencies requires pod_name", async () => {
    await expect(
      handleK8sTopology({ action: "pod_dependencies" })
    ).rejects.toThrow("pod_name is required");
  });

  it("namespace_map shows resource counts", async () => {
    mockListNamespacedDeployment.mockResolvedValue({ body: { items: [{}, {}] } });
    mockListNamespacedStatefulSet.mockResolvedValue({ body: { items: [{}] } });
    mockListNamespacedDaemonSet.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          { status: { phase: "Running" } },
          { status: { phase: "Running" } },
          { status: { phase: "Pending" } },
        ],
      },
    });
    mockListNamespacedService.mockResolvedValue({ body: { items: [{}, {}] } });
    mockListNamespacedIngress.mockResolvedValue({ body: { items: [{}] } });
    mockListNamespacedConfigMap.mockResolvedValue({ body: { items: [{}, {}, {}] } });
    mockListNamespacedSecret.mockResolvedValue({ body: { items: [{}, {}] } });
    mockListNamespacedPersistentVolumeClaim.mockResolvedValue({ body: { items: [{}] } });

    const result = await handleK8sTopology({ action: "namespace_map", namespace: "production" });
    expect(result).toContain("Namespace: production");
    expect(result).toContain("Deployments");
    expect(result).toContain("2");
    expect(result).toContain("StatefulSets");
    expect(result).toContain("1");
    expect(result).toContain("2 Running, 1 Pending, 0 Failed/Unknown");
  });
});
