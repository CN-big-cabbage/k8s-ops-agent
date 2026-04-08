import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sStatefulSetSchema } from "./statefulset.js";

const mockListNamespacedStatefulSet = vi.fn();
const mockListStatefulSetForAllNamespaces = vi.fn();
const mockReadNamespacedStatefulSet = vi.fn();
const mockReplaceNamespacedStatefulSet = vi.fn();
const mockListNamespacedPersistentVolumeClaim = vi.fn();
const mockListNamespacedEvent = vi.fn();
const mockListNamespacedControllerRevision = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    appsApi: {
      listNamespacedStatefulSet: mockListNamespacedStatefulSet,
      listStatefulSetForAllNamespaces: mockListStatefulSetForAllNamespaces,
      readNamespacedStatefulSet: mockReadNamespacedStatefulSet,
      replaceNamespacedStatefulSet: mockReplaceNamespacedStatefulSet,
      listNamespacedControllerRevision: mockListNamespacedControllerRevision,
    },
    coreApi: {
      listNamespacedPersistentVolumeClaim: mockListNamespacedPersistentVolumeClaim,
      listNamespacedEvent: mockListNamespacedEvent,
    },
  }),
}));

const { handleK8sStatefulSet } = await import("./statefulset.js");

describe("K8sStatefulSetSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sStatefulSetSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list", "describe", "status", "scale", "rollout_restart", "rollout_undo", "update_image"];
    for (const action of actions) {
      const result = K8sStatefulSetSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sStatefulSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list returns formatted table", async () => {
    mockListNamespacedStatefulSet.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "mysql", namespace: "default", creationTimestamp: new Date() },
            spec: { replicas: 3 },
            status: { readyReplicas: 3, currentReplicas: 3, updatedReplicas: 3 },
          },
        ],
      },
    });

    const result = await handleK8sStatefulSet({ action: "list", namespace: "default" });
    expect(result).toContain("mysql");
    expect(result).toContain("3/3");
  });

  it("list all namespaces", async () => {
    mockListStatefulSetForAllNamespaces.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "redis", namespace: "cache", creationTimestamp: new Date() },
            spec: { replicas: 2 },
            status: { readyReplicas: 2, currentReplicas: 2, updatedReplicas: 2 },
          },
        ],
      },
    });

    const result = await handleK8sStatefulSet({ action: "list", all_namespaces: true });
    expect(result).toContain("redis");
    expect(result).toContain("cache");
  });

  it("describe shows detailed info", async () => {
    mockReadNamespacedStatefulSet.mockResolvedValue({
      body: {
        metadata: { name: "mysql", namespace: "default", labels: { app: "mysql" }, creationTimestamp: new Date() },
        spec: {
          replicas: 3,
          selector: { matchLabels: { app: "mysql" } },
          template: { spec: { containers: [{ name: "mysql", image: "mysql:8.0", ports: [{ containerPort: 3306 }] }] } },
          volumeClaimTemplates: [{ metadata: { name: "data" }, spec: { resources: { requests: { storage: "10Gi" } } } }],
        },
        status: { readyReplicas: 3, currentReplicas: 3, updatedReplicas: 3 },
      },
    });
    mockListNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: { items: [{ metadata: { name: "data-mysql-0" }, status: { phase: "Bound" } }] },
    });
    mockListNamespacedEvent.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sStatefulSet({ action: "describe", statefulset_name: "mysql" });
    expect(result).toContain("mysql");
    expect(result).toContain("mysql:8.0");
    expect(result).toContain("data-mysql-0");
  });

  it("describe requires statefulset_name", async () => {
    await expect(
      handleK8sStatefulSet({ action: "describe" })
    ).rejects.toThrow("statefulset_name is required");
  });

  it("status shows replica counts", async () => {
    mockReadNamespacedStatefulSet.mockResolvedValue({
      body: {
        metadata: { name: "mysql", namespace: "default" },
        spec: { replicas: 3 },
        status: { readyReplicas: 2, currentReplicas: 3, updatedReplicas: 3 },
      },
    });

    const result = await handleK8sStatefulSet({ action: "status", statefulset_name: "mysql" });
    expect(result).toContain("2/3");
  });

  it("scale updates replicas", async () => {
    mockReadNamespacedStatefulSet.mockResolvedValue({
      body: {
        metadata: { name: "mysql", namespace: "default" },
        spec: { replicas: 3 },
      },
    });
    mockReplaceNamespacedStatefulSet.mockResolvedValue({});

    const result = await handleK8sStatefulSet({
      action: "scale",
      statefulset_name: "mysql",
      namespace: "default",
      replicas: 5,
    });
    expect(result).toContain("scaled to 5");
  });

  it("scale requires statefulset_name", async () => {
    await expect(
      handleK8sStatefulSet({ action: "scale", replicas: 3 })
    ).rejects.toThrow("statefulset_name is required");
  });

  it("scale requires replicas", async () => {
    await expect(
      handleK8sStatefulSet({ action: "scale", statefulset_name: "mysql" })
    ).rejects.toThrow("replicas is required");
  });

  it("rollout_restart adds restart annotation", async () => {
    mockReadNamespacedStatefulSet.mockResolvedValue({
      body: {
        metadata: { name: "mysql", namespace: "default" },
        spec: { template: { metadata: { annotations: {} }, spec: { containers: [] } } },
      },
    });
    mockReplaceNamespacedStatefulSet.mockResolvedValue({});

    const result = await handleK8sStatefulSet({
      action: "rollout_restart",
      statefulset_name: "mysql",
    });
    expect(result).toContain("restarted");
  });

  it("rollout_restart requires statefulset_name", async () => {
    await expect(
      handleK8sStatefulSet({ action: "rollout_restart" })
    ).rejects.toThrow("statefulset_name is required");
  });

  it("rollout_undo restores previous revision", async () => {
    mockReadNamespacedStatefulSet.mockResolvedValue({
      body: {
        metadata: { name: "mysql", namespace: "default", labels: { app: "mysql" } },
        spec: {
          selector: { matchLabels: { app: "mysql" } },
          template: { spec: { containers: [{ name: "mysql", image: "mysql:8.0" }] } },
        },
      },
    });
    mockListNamespacedControllerRevision.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "mysql-rev1", labels: { app: "mysql" } },
            revision: 1,
            data: { spec: { template: { spec: { containers: [{ name: "mysql", image: "mysql:5.7" }] } } } },
          },
          {
            metadata: { name: "mysql-rev2", labels: { app: "mysql" } },
            revision: 2,
            data: { spec: { template: { spec: { containers: [{ name: "mysql", image: "mysql:8.0" }] } } } },
          },
        ],
      },
    });
    mockReplaceNamespacedStatefulSet.mockResolvedValue({});

    const result = await handleK8sStatefulSet({
      action: "rollout_undo",
      statefulset_name: "mysql",
    });
    expect(result).toContain("rolled back");
    expect(result).toContain("revision 1");
  });

  it("update_image requires all params", async () => {
    await expect(
      handleK8sStatefulSet({ action: "update_image", statefulset_name: "mysql" })
    ).rejects.toThrow("container is required");
  });

  it("update_image updates container image", async () => {
    mockReadNamespacedStatefulSet.mockResolvedValue({
      body: {
        metadata: { name: "mysql", namespace: "default" },
        spec: { template: { spec: { containers: [{ name: "mysql", image: "mysql:8.0" }] } } },
      },
    });
    mockReplaceNamespacedStatefulSet.mockResolvedValue({});

    const result = await handleK8sStatefulSet({
      action: "update_image",
      statefulset_name: "mysql",
      container: "mysql",
      image: "mysql:8.1",
    });
    expect(result).toContain("mysql:8.1");
  });
});
