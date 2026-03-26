import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sPodSchema } from "./pod.js";

// Mock createK8sClients before importing handler
const mockReadNamespacedPod = vi.fn();
const mockDeleteNamespacedPod = vi.fn();

vi.mock("../../../lib/client.js", () => ({
  createK8sClients: () => ({
    coreApi: {
      readNamespacedPod: mockReadNamespacedPod,
      deleteNamespacedPod: mockDeleteNamespacedPod,
      listNamespacedPod: vi.fn(),
      listPodForAllNamespaces: vi.fn(),
      listNamespacedEvent: vi.fn(),
      readNamespacedPodLog: vi.fn(),
    },
  }),
}));

// Import after mocks are set up
const { handleK8sPod } = await import("./pod.js");

describe("K8sPodSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sPodSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts valid actions", () => {
    const actions = ["list", "describe", "logs", "restart", "status"];
    for (const action of actions) {
      const result = K8sPodSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });

  it("defaults namespace to undefined (optional)", () => {
    const result = K8sPodSchema.parse({ action: "list" });
    expect(result.namespace).toBeUndefined();
  });
});

describe("handleK8sPod restart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes pod with controller and returns success message", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        metadata: {
          name: "web-abc123",
          namespace: "default",
          ownerReferences: [
            { kind: "ReplicaSet", name: "web-abc", controller: true },
          ],
        },
      },
    });
    mockDeleteNamespacedPod.mockResolvedValue({});

    const result = await handleK8sPod({
      action: "restart",
      pod_name: "web-abc123",
    });

    expect(mockDeleteNamespacedPod).toHaveBeenCalledWith("web-abc123", "default");
    expect(result).toContain("deleted");
    expect(result).toContain("ReplicaSet");
  });

  it("shows correct controller kind (StatefulSet)", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        metadata: {
          name: "db-0",
          namespace: "production",
          ownerReferences: [
            { kind: "StatefulSet", name: "db", controller: true },
          ],
        },
      },
    });
    mockDeleteNamespacedPod.mockResolvedValue({});

    const result = await handleK8sPod({
      action: "restart",
      namespace: "production",
      pod_name: "db-0",
    });

    expect(result).toContain("StatefulSet");
    expect(mockDeleteNamespacedPod).toHaveBeenCalledWith("db-0", "production");
  });

  it("refuses to delete standalone pod without controller", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        metadata: {
          name: "standalone-pod",
          namespace: "default",
          ownerReferences: [],
        },
      },
    });

    await expect(
      handleK8sPod({ action: "restart", pod_name: "standalone-pod" })
    ).rejects.toThrow("no controller");

    expect(mockDeleteNamespacedPod).not.toHaveBeenCalled();
  });

  it("refuses to delete pod with no ownerReferences field", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        metadata: {
          name: "bare-pod",
          namespace: "default",
        },
      },
    });

    await expect(
      handleK8sPod({ action: "restart", pod_name: "bare-pod" })
    ).rejects.toThrow("will NOT be recreated");

    expect(mockDeleteNamespacedPod).not.toHaveBeenCalled();
  });

  it("refuses when ownerReferences exist but none is a controller", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        metadata: {
          name: "owned-pod",
          namespace: "default",
          ownerReferences: [
            { kind: "ConfigMap", name: "some-cm", controller: false },
          ],
        },
      },
    });

    await expect(
      handleK8sPod({ action: "restart", pod_name: "owned-pod" })
    ).rejects.toThrow("no controller");

    expect(mockDeleteNamespacedPod).not.toHaveBeenCalled();
  });

  it("throws when pod_name is missing", async () => {
    await expect(
      handleK8sPod({ action: "restart" })
    ).rejects.toThrow("pod_name is required");
  });
});
