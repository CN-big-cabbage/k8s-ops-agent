import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sDaemonSetSchema } from "./daemonset.js";

const mockListNamespacedDaemonSet = vi.fn();
const mockListDaemonSetForAllNamespaces = vi.fn();
const mockReadNamespacedDaemonSet = vi.fn();
const mockReplaceNamespacedDaemonSet = vi.fn();
const mockListNamespacedEvent = vi.fn();

vi.mock("../../../lib/client.js", () => ({
  createK8sClients: () => ({
    appsApi: {
      listNamespacedDaemonSet: mockListNamespacedDaemonSet,
      listDaemonSetForAllNamespaces: mockListDaemonSetForAllNamespaces,
      readNamespacedDaemonSet: mockReadNamespacedDaemonSet,
      replaceNamespacedDaemonSet: mockReplaceNamespacedDaemonSet,
    },
    coreApi: {
      listNamespacedEvent: mockListNamespacedEvent,
    },
  }),
}));

const { handleK8sDaemonSet } = await import("./daemonset.js");

describe("K8sDaemonSetSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sDaemonSetSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list", "describe", "status", "rollout_restart", "update_image"];
    for (const action of actions) {
      const result = K8sDaemonSetSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sDaemonSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list returns formatted table", async () => {
    mockListNamespacedDaemonSet.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "fluentd", namespace: "kube-system", creationTimestamp: new Date() },
            status: {
              desiredNumberScheduled: 3,
              currentNumberScheduled: 3,
              numberReady: 3,
              numberMisscheduled: 0,
              updatedNumberScheduled: 3,
              numberAvailable: 3,
            },
          },
        ],
      },
    });

    const result = await handleK8sDaemonSet({ action: "list", namespace: "kube-system" });
    expect(result).toContain("fluentd");
    expect(result).toContain("3");
  });

  it("list all namespaces", async () => {
    mockListDaemonSetForAllNamespaces.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "node-exporter", namespace: "monitoring", creationTimestamp: new Date() },
            status: {
              desiredNumberScheduled: 5,
              currentNumberScheduled: 5,
              numberReady: 5,
              numberMisscheduled: 0,
              updatedNumberScheduled: 5,
              numberAvailable: 5,
            },
          },
        ],
      },
    });

    const result = await handleK8sDaemonSet({ action: "list", all_namespaces: true });
    expect(result).toContain("node-exporter");
    expect(result).toContain("monitoring");
  });

  it("describe shows detailed info", async () => {
    mockReadNamespacedDaemonSet.mockResolvedValue({
      body: {
        metadata: { name: "fluentd", namespace: "kube-system", labels: { app: "fluentd" }, creationTimestamp: new Date() },
        spec: {
          selector: { matchLabels: { app: "fluentd" } },
          template: {
            spec: {
              containers: [{ name: "fluentd", image: "fluentd:v1.16", ports: [{ containerPort: 24224 }] }],
              nodeSelector: { "kubernetes.io/os": "linux" },
              tolerations: [{ operator: "Exists" }],
            },
          },
        },
        status: {
          desiredNumberScheduled: 3,
          currentNumberScheduled: 3,
          numberReady: 3,
          numberMisscheduled: 0,
          updatedNumberScheduled: 3,
          numberAvailable: 3,
        },
      },
    });
    mockListNamespacedEvent.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sDaemonSet({ action: "describe", daemonset_name: "fluentd", namespace: "kube-system" });
    expect(result).toContain("fluentd");
    expect(result).toContain("fluentd:v1.16");
    expect(result).toContain("linux");
  });

  it("describe requires daemonset_name", async () => {
    await expect(
      handleK8sDaemonSet({ action: "describe" })
    ).rejects.toThrow("daemonset_name is required");
  });

  it("status shows node coverage", async () => {
    mockReadNamespacedDaemonSet.mockResolvedValue({
      body: {
        metadata: { name: "fluentd", namespace: "kube-system" },
        status: {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 5,
          numberReady: 4,
          numberMisscheduled: 0,
          updatedNumberScheduled: 5,
          numberAvailable: 4,
        },
      },
    });

    const result = await handleK8sDaemonSet({
      action: "status",
      daemonset_name: "fluentd",
      namespace: "kube-system",
    });
    expect(result).toContain("4/5");
  });

  it("rollout_restart requires daemonset_name", async () => {
    await expect(
      handleK8sDaemonSet({ action: "rollout_restart" })
    ).rejects.toThrow("daemonset_name is required");
  });

  it("rollout_restart adds restart annotation", async () => {
    mockReadNamespacedDaemonSet.mockResolvedValue({
      body: {
        metadata: { name: "fluentd", namespace: "kube-system" },
        spec: { template: { metadata: { annotations: {} }, spec: { containers: [] } } },
      },
    });
    mockReplaceNamespacedDaemonSet.mockResolvedValue({});

    const result = await handleK8sDaemonSet({
      action: "rollout_restart",
      daemonset_name: "fluentd",
      namespace: "kube-system",
    });
    expect(result).toContain("restarted");
  });

  it("update_image requires all params", async () => {
    await expect(
      handleK8sDaemonSet({ action: "update_image", daemonset_name: "fluentd" })
    ).rejects.toThrow("container is required");
  });

  it("update_image updates container image", async () => {
    mockReadNamespacedDaemonSet.mockResolvedValue({
      body: {
        metadata: { name: "fluentd", namespace: "kube-system" },
        spec: { template: { spec: { containers: [{ name: "fluentd", image: "fluentd:v1.16" }] } } },
      },
    });
    mockReplaceNamespacedDaemonSet.mockResolvedValue({});

    const result = await handleK8sDaemonSet({
      action: "update_image",
      daemonset_name: "fluentd",
      namespace: "kube-system",
      container: "fluentd",
      image: "fluentd:v1.17",
    });
    expect(result).toContain("fluentd:v1.17");
  });
});
