import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sPdbSchema } from "./pdb.js";

const mockListNamespacedPodDisruptionBudget = vi.fn();
const mockListPodDisruptionBudgetForAllNamespaces = vi.fn();
const mockReadNamespacedPodDisruptionBudget = vi.fn();
const mockCreateNamespacedPodDisruptionBudget = vi.fn();
const mockDeleteNamespacedPodDisruptionBudget = vi.fn();
const mockReadNamespacedDeployment = vi.fn();
const mockReadNamespacedStatefulSet = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    policyApi: {
      listNamespacedPodDisruptionBudget: mockListNamespacedPodDisruptionBudget,
      listPodDisruptionBudgetForAllNamespaces: mockListPodDisruptionBudgetForAllNamespaces,
      readNamespacedPodDisruptionBudget: mockReadNamespacedPodDisruptionBudget,
      createNamespacedPodDisruptionBudget: mockCreateNamespacedPodDisruptionBudget,
      deleteNamespacedPodDisruptionBudget: mockDeleteNamespacedPodDisruptionBudget,
    },
    appsApi: {
      readNamespacedDeployment: mockReadNamespacedDeployment,
      readNamespacedStatefulSet: mockReadNamespacedStatefulSet,
    },
  }),
}));

const { handleK8sPdb } = await import("./pdb.js");

describe("K8sPdbSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sPdbSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list", "describe", "status", "create", "delete", "check"];
    for (const action of actions) {
      const result = K8sPdbSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sPdb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list returns formatted table", async () => {
    mockListNamespacedPodDisruptionBudget.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-pdb", namespace: "default", creationTimestamp: new Date() },
            spec: { minAvailable: "50%", selector: { matchLabels: { app: "web" } } },
            status: { disruptionsAllowed: 1, currentHealthy: 3, desiredHealthy: 2, expectedPods: 3 },
          },
        ],
      },
    });

    const result = await handleK8sPdb({ action: "list", namespace: "default" });
    expect(result).toContain("web-pdb");
    expect(result).toContain("50%");
    expect(result).toContain("1");
  });

  it("list all namespaces", async () => {
    mockListPodDisruptionBudgetForAllNamespaces.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "db-pdb", namespace: "production", creationTimestamp: new Date() },
            spec: { maxUnavailable: 1 },
            status: { disruptionsAllowed: 1 },
          },
        ],
      },
    });

    const result = await handleK8sPdb({ action: "list", all_namespaces: true });
    expect(result).toContain("db-pdb");
    expect(result).toContain("production");
  });

  it("list returns empty message", async () => {
    mockListNamespacedPodDisruptionBudget.mockResolvedValue({
      body: { items: [] },
    });

    const result = await handleK8sPdb({ action: "list" });
    expect(result).toContain("No PodDisruptionBudgets found");
  });

  it("describe shows detailed PDB info", async () => {
    mockReadNamespacedPodDisruptionBudget.mockResolvedValue({
      body: {
        metadata: { name: "web-pdb", namespace: "default", creationTimestamp: new Date() },
        spec: {
          minAvailable: "50%",
          selector: { matchLabels: { app: "web" } },
        },
        status: {
          currentHealthy: 3,
          desiredHealthy: 2,
          disruptionsAllowed: 1,
          expectedPods: 3,
          conditions: [{ type: "SufficientPods", status: "True", reason: "SufficientPods" }],
        },
      },
    });

    const result = await handleK8sPdb({ action: "describe", pdb_name: "web-pdb" });
    expect(result).toContain("web-pdb");
    expect(result).toContain("MinAvailable: 50%");
    expect(result).toContain("CurrentHealthy: 3");
    expect(result).toContain("DisruptionsAllowed: 1");
    expect(result).toContain("app=web");
  });

  it("describe requires pdb_name", async () => {
    await expect(
      handleK8sPdb({ action: "describe" })
    ).rejects.toThrow("pdb_name is required");
  });

  it("status shows protection info", async () => {
    mockReadNamespacedPodDisruptionBudget.mockResolvedValue({
      body: {
        metadata: { name: "web-pdb", namespace: "default" },
        status: {
          currentHealthy: 3,
          desiredHealthy: 2,
          disruptionsAllowed: 1,
          expectedPods: 3,
        },
      },
    });

    const result = await handleK8sPdb({ action: "status", pdb_name: "web-pdb" });
    expect(result).toContain("CurrentHealthy: 3");
    expect(result).toContain("1 disruption(s) allowed");
  });

  it("status shows no disruptions when at minimum", async () => {
    mockReadNamespacedPodDisruptionBudget.mockResolvedValue({
      body: {
        metadata: { name: "web-pdb", namespace: "default" },
        status: {
          currentHealthy: 2,
          desiredHealthy: 2,
          disruptionsAllowed: 0,
          expectedPods: 3,
        },
      },
    });

    const result = await handleK8sPdb({ action: "status", pdb_name: "web-pdb" });
    expect(result).toContain("NO disruptions allowed");
  });

  it("create builds PDB with minAvailable", async () => {
    mockCreateNamespacedPodDisruptionBudget.mockResolvedValue({});

    const result = await handleK8sPdb({
      action: "create",
      pdb_name: "web-pdb",
      target_selector: "app=web",
      min_available: "50%",
    });
    expect(result).toContain("web-pdb");
    expect(result).toContain("created");
    expect(result).toContain("app=web");
  });

  it("create requires pdb_name", async () => {
    await expect(
      handleK8sPdb({ action: "create", target_selector: "app=web", min_available: 2 })
    ).rejects.toThrow("pdb_name is required");
  });

  it("create requires target_selector", async () => {
    await expect(
      handleK8sPdb({ action: "create", pdb_name: "web-pdb", min_available: 2 })
    ).rejects.toThrow("target_selector is required");
  });

  it("create requires min_available or max_unavailable", async () => {
    await expect(
      handleK8sPdb({ action: "create", pdb_name: "web-pdb", target_selector: "app=web" })
    ).rejects.toThrow("Either min_available or max_unavailable is required");
  });

  it("delete removes PDB", async () => {
    mockDeleteNamespacedPodDisruptionBudget.mockResolvedValue({});

    const result = await handleK8sPdb({ action: "delete", pdb_name: "web-pdb" });
    expect(result).toContain("deleted");
  });

  it("delete requires pdb_name", async () => {
    await expect(
      handleK8sPdb({ action: "delete" })
    ).rejects.toThrow("pdb_name is required");
  });

  it("check finds matching PDB for deployment", async () => {
    mockReadNamespacedDeployment.mockResolvedValue({
      body: {
        spec: { selector: { matchLabels: { app: "web" } } },
      },
    });
    mockListNamespacedPodDisruptionBudget.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-pdb" },
            spec: { minAvailable: "50%", selector: { matchLabels: { app: "web" } } },
          },
        ],
      },
    });

    const result = await handleK8sPdb({ action: "check", workload_name: "Deployment/web" });
    expect(result).toContain("Yes");
    expect(result).toContain("web-pdb");
    expect(result).toContain("minAvailable=50%");
  });

  it("check shows unprotected when no PDB matches", async () => {
    mockReadNamespacedDeployment.mockResolvedValue({
      body: {
        spec: { selector: { matchLabels: { app: "web" } } },
      },
    });
    mockListNamespacedPodDisruptionBudget.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "other-pdb" },
            spec: { minAvailable: 1, selector: { matchLabels: { app: "other" } } },
          },
        ],
      },
    });

    const result = await handleK8sPdb({ action: "check", workload_name: "Deployment/web" });
    expect(result).toContain("No");
    expect(result).toContain("UNPROTECTED");
  });

  it("check requires workload_name", async () => {
    await expect(
      handleK8sPdb({ action: "check" })
    ).rejects.toThrow("workload_name is required");
  });

  it("check rejects invalid workload format", async () => {
    await expect(
      handleK8sPdb({ action: "check", workload_name: "web" })
    ).rejects.toThrow("Invalid workload_name format");
  });
});
