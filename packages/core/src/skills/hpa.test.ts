import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sHpaSchema } from "./hpa.js";

const mockListNamespacedHorizontalPodAutoscaler = vi.fn();
const mockListHorizontalPodAutoscalerForAllNamespaces = vi.fn();
const mockReadNamespacedHorizontalPodAutoscaler = vi.fn();
const mockCreateNamespacedHorizontalPodAutoscaler = vi.fn();
const mockPatchNamespacedHorizontalPodAutoscaler = vi.fn();
const mockDeleteNamespacedHorizontalPodAutoscaler = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    autoscalingApi: {
      listNamespacedHorizontalPodAutoscaler: mockListNamespacedHorizontalPodAutoscaler,
      listHorizontalPodAutoscalerForAllNamespaces: mockListHorizontalPodAutoscalerForAllNamespaces,
      readNamespacedHorizontalPodAutoscaler: mockReadNamespacedHorizontalPodAutoscaler,
      createNamespacedHorizontalPodAutoscaler: mockCreateNamespacedHorizontalPodAutoscaler,
      patchNamespacedHorizontalPodAutoscaler: mockPatchNamespacedHorizontalPodAutoscaler,
      deleteNamespacedHorizontalPodAutoscaler: mockDeleteNamespacedHorizontalPodAutoscaler,
    },
  }),
}));

const { handleK8sHpa } = await import("./hpa.js");

describe("K8sHpaSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sHpaSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list", "describe", "status", "create", "update", "delete"];
    for (const action of actions) {
      const result = K8sHpaSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sHpa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list returns formatted table", async () => {
    mockListNamespacedHorizontalPodAutoscaler.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-hpa", namespace: "default", creationTimestamp: new Date() },
            spec: {
              scaleTargetRef: { kind: "Deployment", name: "web", apiVersion: "apps/v1" },
              minReplicas: 2,
              maxReplicas: 10,
            },
            status: { currentReplicas: 3, desiredReplicas: 3 },
          },
        ],
      },
    });

    const result = await handleK8sHpa({ action: "list", namespace: "default" });
    expect(result).toContain("web-hpa");
    expect(result).toContain("2");
    expect(result).toContain("10");
  });

  it("list all namespaces", async () => {
    mockListHorizontalPodAutoscalerForAllNamespaces.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "api-hpa", namespace: "production", creationTimestamp: new Date() },
            spec: {
              scaleTargetRef: { kind: "Deployment", name: "api", apiVersion: "apps/v1" },
              minReplicas: 3,
              maxReplicas: 20,
            },
            status: { currentReplicas: 5, desiredReplicas: 5 },
          },
        ],
      },
    });

    const result = await handleK8sHpa({ action: "list", all_namespaces: true });
    expect(result).toContain("api-hpa");
    expect(result).toContain("production");
  });

  it("describe shows detailed info", async () => {
    mockReadNamespacedHorizontalPodAutoscaler.mockResolvedValue({
      body: {
        metadata: { name: "web-hpa", namespace: "default", creationTimestamp: new Date() },
        spec: {
          scaleTargetRef: { kind: "Deployment", name: "web", apiVersion: "apps/v1" },
          minReplicas: 2,
          maxReplicas: 10,
          metrics: [
            {
              type: "Resource",
              resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 80 } },
            },
          ],
        },
        status: {
          currentReplicas: 3,
          desiredReplicas: 3,
          currentMetrics: [
            {
              type: "Resource",
              resource: { name: "cpu", current: { averageUtilization: 45 } },
            },
          ],
          conditions: [{ type: "AbleToScale", status: "True", reason: "ReadyForNewScale" }],
        },
      },
    });

    const result = await handleK8sHpa({ action: "describe", hpa_name: "web-hpa" });
    expect(result).toContain("web-hpa");
    expect(result).toContain("Deployment/web");
    expect(result).toContain("80");
    expect(result).toContain("45");
  });

  it("describe requires hpa_name", async () => {
    await expect(
      handleK8sHpa({ action: "describe" })
    ).rejects.toThrow("hpa_name is required");
  });

  it("status shows current vs desired", async () => {
    mockReadNamespacedHorizontalPodAutoscaler.mockResolvedValue({
      body: {
        metadata: { name: "web-hpa", namespace: "default" },
        spec: {
          scaleTargetRef: { kind: "Deployment", name: "web", apiVersion: "apps/v1" },
          minReplicas: 2,
          maxReplicas: 10,
        },
        status: { currentReplicas: 3, desiredReplicas: 5 },
      },
    });

    const result = await handleK8sHpa({ action: "status", hpa_name: "web-hpa" });
    expect(result).toContain("3");
    expect(result).toContain("5");
  });

  it("create builds HPA with cpu target", async () => {
    mockCreateNamespacedHorizontalPodAutoscaler.mockResolvedValue({
      body: { metadata: { name: "web-hpa", namespace: "default" } },
    });

    const result = await handleK8sHpa({
      action: "create",
      hpa_name: "web-hpa",
      target_ref: "Deployment/web",
      min_replicas: 2,
      max_replicas: 10,
      cpu_target: 80,
    });
    expect(result).toContain("web-hpa");
    expect(result).toContain("created");
  });

  it("create requires hpa_name", async () => {
    await expect(
      handleK8sHpa({ action: "create" })
    ).rejects.toThrow("hpa_name is required");
  });

  it("create requires target_ref", async () => {
    await expect(
      handleK8sHpa({ action: "create", hpa_name: "web-hpa" })
    ).rejects.toThrow("target_ref is required");
  });

  it("update patches min/max replicas", async () => {
    mockReadNamespacedHorizontalPodAutoscaler.mockResolvedValue({
      body: {
        metadata: { name: "web-hpa", namespace: "default" },
        spec: {
          scaleTargetRef: { kind: "Deployment", name: "web", apiVersion: "apps/v1" },
          minReplicas: 2,
          maxReplicas: 10,
        },
      },
    });
    mockPatchNamespacedHorizontalPodAutoscaler.mockResolvedValue({});

    const result = await handleK8sHpa({
      action: "update",
      hpa_name: "web-hpa",
      min_replicas: 3,
      max_replicas: 15,
    });
    expect(result).toContain("updated");
  });

  it("update requires hpa_name", async () => {
    await expect(
      handleK8sHpa({ action: "update" })
    ).rejects.toThrow("hpa_name is required");
  });

  it("delete removes HPA", async () => {
    mockDeleteNamespacedHorizontalPodAutoscaler.mockResolvedValue({});

    const result = await handleK8sHpa({
      action: "delete",
      hpa_name: "web-hpa",
    });
    expect(result).toContain("deleted");
  });

  it("delete requires hpa_name", async () => {
    await expect(
      handleK8sHpa({ action: "delete" })
    ).rejects.toThrow("hpa_name is required");
  });
});
