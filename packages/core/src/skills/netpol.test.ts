import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sNetPolSchema } from "./netpol.js";

const mockListNamespacedNetworkPolicy = vi.fn();
const mockListNetworkPolicyForAllNamespaces = vi.fn();
const mockReadNamespacedNetworkPolicy = vi.fn();
const mockCreateNamespacedNetworkPolicy = vi.fn();
const mockDeleteNamespacedNetworkPolicy = vi.fn();
const mockReadNamespacedPod = vi.fn();
const mockListNamespacedPod = vi.fn();
const mockListNamespace = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    coreApi: {
      readNamespacedPod: mockReadNamespacedPod,
      listNamespacedPod: mockListNamespacedPod,
      listNamespace: mockListNamespace,
    },
    networkingApi: {
      listNamespacedNetworkPolicy: mockListNamespacedNetworkPolicy,
      listNetworkPolicyForAllNamespaces: mockListNetworkPolicyForAllNamespaces,
      readNamespacedNetworkPolicy: mockReadNamespacedNetworkPolicy,
      createNamespacedNetworkPolicy: mockCreateNamespacedNetworkPolicy,
      deleteNamespacedNetworkPolicy: mockDeleteNamespacedNetworkPolicy,
    },
  }),
}));

const { handleK8sNetPol } = await import("./netpol.js");

describe("K8sNetPolSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sNetPolSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list", "describe", "check_pod", "create", "delete", "audit"];
    for (const action of actions) {
      const result = K8sNetPolSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sNetPol", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list returns formatted table", async () => {
    mockListNamespacedNetworkPolicy.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "deny-all", namespace: "default", creationTimestamp: new Date() },
            spec: {
              podSelector: { matchLabels: { app: "web" } },
              policyTypes: ["Ingress", "Egress"],
            },
          },
        ],
      },
    });

    const result = await handleK8sNetPol({ action: "list", namespace: "default" });
    expect(result).toContain("deny-all");
    expect(result).toContain("app=web");
    expect(result).toContain("Ingress,Egress");
  });

  it("list all namespaces", async () => {
    mockListNetworkPolicyForAllNamespaces.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "prod-policy", namespace: "production", creationTimestamp: new Date() },
            spec: {
              podSelector: {},
              policyTypes: ["Ingress"],
            },
          },
        ],
      },
    });

    const result = await handleK8sNetPol({ action: "list", all_namespaces: true });
    expect(result).toContain("prod-policy");
    expect(result).toContain("production");
  });

  it("describe parses ingress/egress rules", async () => {
    mockReadNamespacedNetworkPolicy.mockResolvedValue({
      body: {
        metadata: { name: "allow-monitoring", namespace: "default" },
        spec: {
          podSelector: { matchLabels: { app: "web" } },
          policyTypes: ["Ingress", "Egress"],
          ingress: [
            {
              from: [
                {
                  namespaceSelector: { matchLabels: { name: "monitoring" } },
                  podSelector: { matchLabels: { app: "prometheus" } },
                },
              ],
              ports: [{ protocol: "TCP", port: 9090 }],
            },
            {
              from: [{ ipBlock: { cidr: "10.0.0.0/8" } }],
              ports: [{ protocol: "TCP", port: 80 }, { protocol: "TCP", port: 443 }],
            },
          ],
          egress: [
            {
              to: [{ ipBlock: { cidr: "0.0.0.0/0", except: ["169.254.169.254/32"] } }],
              ports: [{ protocol: "TCP", port: 443 }],
            },
          ],
        },
      },
    });

    const result = await handleK8sNetPol({
      action: "describe",
      policy_name: "allow-monitoring",
      namespace: "default",
    });
    expect(result).toContain("allow-monitoring");
    expect(result).toContain("namespace=name=monitoring");
    expect(result).toContain("pods=app=prometheus");
    expect(result).toContain("TCP/9090");
    expect(result).toContain("cidr=10.0.0.0/8");
    expect(result).toContain("TCP/80");
    expect(result).toContain("TCP/443");
    expect(result).toContain("Egress Rules");
    expect(result).toContain("except=169.254.169.254/32");
  });

  it("describe requires policy_name", async () => {
    await expect(
      handleK8sNetPol({ action: "describe" })
    ).rejects.toThrow("policy_name is required");
  });

  it("check_pod matches pod labels against policy selectors", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        metadata: { name: "web-abc", namespace: "default", labels: { app: "web", tier: "frontend" } },
      },
    });

    mockListNamespacedNetworkPolicy.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-policy", namespace: "default" },
            spec: {
              podSelector: { matchLabels: { app: "web" } },
              policyTypes: ["Ingress"],
            },
          },
          {
            metadata: { name: "api-policy", namespace: "default" },
            spec: {
              podSelector: { matchLabels: { app: "api" } },
              policyTypes: ["Ingress", "Egress"],
            },
          },
        ],
      },
    });

    const result = await handleK8sNetPol({
      action: "check_pod",
      pod_name: "web-abc",
      namespace: "default",
    });
    expect(result).toContain("web-policy");
    expect(result).not.toContain("api-policy");
    expect(result).toContain("1 policies apply");
  });

  it("check_pod requires pod_name", async () => {
    await expect(
      handleK8sNetPol({ action: "check_pod" })
    ).rejects.toThrow("pod_name is required");
  });

  it("create builds correct NetworkPolicy object", async () => {
    mockCreateNamespacedNetworkPolicy.mockResolvedValue({
      body: { metadata: { name: "allow-monitoring", namespace: "default" } },
    });

    const result = await handleK8sNetPol({
      action: "create",
      policy_name: "allow-monitoring",
      namespace: "default",
      pod_selector: "app=web",
      ingress_allow: "namespace=monitoring",
      egress_allow: "cidr=10.0.0.0/8",
    });
    expect(result).toContain("allow-monitoring");
    expect(result).toContain("created");

    const callArg = mockCreateNamespacedNetworkPolicy.mock.calls[0][1];
    expect(callArg.spec.podSelector.matchLabels).toEqual({ app: "web" });
    expect(callArg.spec.ingress[0].from[0].namespaceSelector.matchLabels).toEqual({ "kubernetes.io/metadata.name": "monitoring" });
    expect(callArg.spec.egress[0].to[0].ipBlock.cidr).toBe("10.0.0.0/8");
    expect(callArg.spec.policyTypes).toEqual(["Ingress", "Egress"]);
  });

  it("create requires policy_name", async () => {
    await expect(
      handleK8sNetPol({ action: "create" })
    ).rejects.toThrow("policy_name is required");
  });

  it("delete removes NetworkPolicy", async () => {
    mockDeleteNamespacedNetworkPolicy.mockResolvedValue({});

    const result = await handleK8sNetPol({
      action: "delete",
      policy_name: "deny-all",
      namespace: "default",
    });
    expect(result).toContain("deleted");
  });

  it("delete requires policy_name", async () => {
    await expect(
      handleK8sNetPol({ action: "delete" })
    ).rejects.toThrow("policy_name is required");
  });

  it("audit identifies unprotected namespaces", async () => {
    mockListNamespace.mockResolvedValue({
      body: {
        items: [
          { metadata: { name: "default" } },
          { metadata: { name: "production" } },
          { metadata: { name: "monitoring" } },
          { metadata: { name: "kube-system" } },
        ],
      },
    });

    // default: has netpol
    mockListNamespacedNetworkPolicy
      .mockResolvedValueOnce({ body: { items: [{ metadata: { name: "np1" } }] } })
      // production: no netpol, has pods
      .mockResolvedValueOnce({ body: { items: [] } })
      // monitoring: no netpol, no pods
      .mockResolvedValueOnce({ body: { items: [] } });

    mockListNamespacedPod
      .mockResolvedValueOnce({ body: { items: [{ metadata: { name: "pod1" } }] } })
      .mockResolvedValueOnce({ body: { items: [{ metadata: { name: "pod2" } }, { metadata: { name: "pod3" } }] } })
      .mockResolvedValueOnce({ body: { items: [] } });

    const result = await handleK8sNetPol({ action: "audit" });
    expect(result).toContain("default");
    expect(result).toContain("production");
    expect(result).toContain("HIGH");
    expect(result).toContain("monitoring");
    expect(result).not.toContain("kube-system");
  });
});
