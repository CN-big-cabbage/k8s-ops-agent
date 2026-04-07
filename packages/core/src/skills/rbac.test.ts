import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sRbacSchema } from "./rbac.js";

const mockListNamespacedServiceAccount = vi.fn();
const mockListServiceAccountForAllNamespaces = vi.fn();
const mockReadNamespacedServiceAccount = vi.fn();
const mockListClusterRole = vi.fn();
const mockListNamespacedRole = vi.fn();
const mockListRoleForAllNamespaces = vi.fn();
const mockReadClusterRole = vi.fn();
const mockReadNamespacedRole = vi.fn();
const mockListClusterRoleBinding = vi.fn();
const mockListNamespacedRoleBinding = vi.fn();
const mockListRoleBindingForAllNamespaces = vi.fn();
const mockReadClusterRoleBinding = vi.fn();
const mockReadNamespacedRoleBinding = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    coreApi: {
      listNamespacedServiceAccount: mockListNamespacedServiceAccount,
      listServiceAccountForAllNamespaces: mockListServiceAccountForAllNamespaces,
      readNamespacedServiceAccount: mockReadNamespacedServiceAccount,
    },
    rbacApi: {
      listClusterRole: mockListClusterRole,
      listNamespacedRole: mockListNamespacedRole,
      listRoleForAllNamespaces: mockListRoleForAllNamespaces,
      readClusterRole: mockReadClusterRole,
      readNamespacedRole: mockReadNamespacedRole,
      listClusterRoleBinding: mockListClusterRoleBinding,
      listNamespacedRoleBinding: mockListNamespacedRoleBinding,
      listRoleBindingForAllNamespaces: mockListRoleBindingForAllNamespaces,
      readClusterRoleBinding: mockReadClusterRoleBinding,
      readNamespacedRoleBinding: mockReadNamespacedRoleBinding,
    },
  }),
}));

const { handleK8sRbac } = await import("./rbac.js");

describe("K8sRbacSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sRbacSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = [
      "list_sa", "describe_sa", "list_roles", "describe_role",
      "list_bindings", "describe_binding", "who_can", "audit_sa",
    ];
    for (const action of actions) {
      const result = K8sRbacSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sRbac", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list_sa returns formatted table", async () => {
    mockListNamespacedServiceAccount.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "default", namespace: "default", creationTimestamp: new Date() },
            secrets: [{ name: "default-token-abc" }],
          },
          {
            metadata: { name: "my-sa", namespace: "default", creationTimestamp: new Date() },
            secrets: [],
          },
        ],
      },
    });

    const result = await handleK8sRbac({ action: "list_sa", namespace: "default" });
    expect(result).toContain("default");
    expect(result).toContain("my-sa");
    expect(result).toContain("NAMESPACE");
    expect(result).toContain("SECRETS");
  });

  it("list_sa all namespaces", async () => {
    mockListServiceAccountForAllNamespaces.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "sa-prod", namespace: "production", creationTimestamp: new Date() },
            secrets: [],
          },
        ],
      },
    });

    const result = await handleK8sRbac({ action: "list_sa", all_namespaces: true });
    expect(result).toContain("sa-prod");
    expect(result).toContain("production");
  });

  it("describe_sa shows details", async () => {
    mockReadNamespacedServiceAccount.mockResolvedValue({
      body: {
        metadata: {
          name: "my-sa",
          namespace: "default",
          creationTimestamp: new Date(),
          labels: { app: "web" },
        },
        secrets: [{ name: "my-sa-token-xyz" }],
        imagePullSecrets: [{ name: "registry-secret" }],
      },
    });

    const result = await handleK8sRbac({ action: "describe_sa", name: "my-sa" });
    expect(result).toContain("my-sa");
    expect(result).toContain("my-sa-token-xyz");
    expect(result).toContain("registry-secret");
    expect(result).toContain("app: web");
  });

  it("describe_sa requires name", async () => {
    await expect(
      handleK8sRbac({ action: "describe_sa" })
    ).rejects.toThrow("name is required");
  });

  it("list_roles returns namespaced roles", async () => {
    mockListNamespacedRole.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "pod-reader", namespace: "default" },
            rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }],
          },
        ],
      },
    });

    const result = await handleK8sRbac({ action: "list_roles", namespace: "default" });
    expect(result).toContain("pod-reader");
    expect(result).toContain("Namespaced");
    expect(result).toContain("1");
  });

  it("list_roles with cluster_scope", async () => {
    mockListClusterRole.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "cluster-admin" },
            rules: [
              { apiGroups: ["*"], resources: ["*"], verbs: ["*"] },
            ],
          },
        ],
      },
    });

    const result = await handleK8sRbac({ action: "list_roles", cluster_scope: true });
    expect(result).toContain("cluster-admin");
    expect(result).toContain("Cluster");
  });

  it("describe_role shows rules", async () => {
    mockReadNamespacedRole.mockResolvedValue({
      body: {
        metadata: { name: "pod-reader", namespace: "default" },
        rules: [
          { apiGroups: [""], resources: ["pods"], verbs: ["get", "list", "watch"] },
          { apiGroups: ["apps"], resources: ["deployments"], verbs: ["get"] },
        ],
      },
    });

    const result = await handleK8sRbac({
      action: "describe_role",
      name: "pod-reader",
      namespace: "default",
    });
    expect(result).toContain("pod-reader");
    expect(result).toContain("pods");
    expect(result).toContain("get");
    expect(result).toContain("deployments");
  });

  it("describe_role cluster scope", async () => {
    mockReadClusterRole.mockResolvedValue({
      body: {
        metadata: { name: "cluster-admin" },
        rules: [
          { apiGroups: ["*"], resources: ["*"], verbs: ["*"] },
        ],
      },
    });

    const result = await handleK8sRbac({
      action: "describe_role",
      name: "cluster-admin",
      cluster_scope: true,
    });
    expect(result).toContain("cluster-admin");
    expect(result).toContain("Cluster");
  });

  it("describe_role requires name", async () => {
    await expect(
      handleK8sRbac({ action: "describe_role" })
    ).rejects.toThrow("name is required");
  });

  it("list_bindings returns namespaced bindings", async () => {
    mockListNamespacedRoleBinding.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "read-pods", namespace: "default" },
            roleRef: { kind: "Role", name: "pod-reader", apiGroup: "rbac.authorization.k8s.io" },
            subjects: [{ kind: "ServiceAccount", name: "my-sa", namespace: "default" }],
          },
        ],
      },
    });

    const result = await handleK8sRbac({ action: "list_bindings", namespace: "default" });
    expect(result).toContain("read-pods");
    expect(result).toContain("Role/pod-reader");
    expect(result).toContain("ServiceAccount/my-sa");
  });

  it("describe_binding shows subjects and roleRef", async () => {
    mockReadNamespacedRoleBinding.mockResolvedValue({
      body: {
        metadata: { name: "read-pods", namespace: "default" },
        roleRef: { kind: "Role", name: "pod-reader", apiGroup: "rbac.authorization.k8s.io" },
        subjects: [
          { kind: "ServiceAccount", name: "my-sa", namespace: "default" },
          { kind: "User", name: "alice" },
        ],
      },
    });

    const result = await handleK8sRbac({
      action: "describe_binding",
      name: "read-pods",
      namespace: "default",
    });
    expect(result).toContain("read-pods");
    expect(result).toContain("pod-reader");
    expect(result).toContain("my-sa");
    expect(result).toContain("alice");
  });

  it("describe_binding requires name", async () => {
    await expect(
      handleK8sRbac({ action: "describe_binding" })
    ).rejects.toThrow("name is required");
  });

  it("who_can finds matching subjects", async () => {
    mockListClusterRoleBinding.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "admin-binding" },
            roleRef: { kind: "ClusterRole", name: "cluster-admin", apiGroup: "rbac.authorization.k8s.io" },
            subjects: [{ kind: "User", name: "admin-user" }],
          },
        ],
      },
    });
    mockReadClusterRole.mockResolvedValue({
      body: {
        rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }],
      },
    });
    mockListNamespacedRoleBinding.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "pod-reader-binding", namespace: "default" },
            roleRef: { kind: "Role", name: "pod-reader", apiGroup: "rbac.authorization.k8s.io" },
            subjects: [{ kind: "ServiceAccount", name: "reader-sa", namespace: "default" }],
          },
        ],
      },
    });
    mockReadNamespacedRole.mockResolvedValue({
      body: {
        rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }],
      },
    });

    const result = await handleK8sRbac({
      action: "who_can",
      verb: "get",
      resource: "pods",
      namespace: "default",
    });
    expect(result).toContain("admin-user");
    expect(result).toContain("reader-sa");
  });

  it("who_can requires verb and resource", async () => {
    await expect(
      handleK8sRbac({ action: "who_can", resource: "pods" })
    ).rejects.toThrow("verb is required");

    await expect(
      handleK8sRbac({ action: "who_can", verb: "get" })
    ).rejects.toThrow("resource is required");
  });

  it("audit_sa flags wildcard permissions as HIGH risk", async () => {
    mockListNamespacedServiceAccount.mockResolvedValue({
      body: {
        items: [
          { metadata: { name: "admin-sa", namespace: "default" } },
          { metadata: { name: "normal-sa", namespace: "default" } },
        ],
      },
    });

    mockListClusterRoleBinding.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "admin-crb" },
            roleRef: { kind: "ClusterRole", name: "cluster-admin", apiGroup: "rbac.authorization.k8s.io" },
            subjects: [{ kind: "ServiceAccount", name: "admin-sa", namespace: "default" }],
          },
        ],
      },
    });

    mockReadClusterRole.mockResolvedValue({
      body: {
        rules: [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }],
      },
    });

    mockListNamespacedRoleBinding.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "normal-rb", namespace: "default" },
            roleRef: { kind: "Role", name: "pod-reader", apiGroup: "rbac.authorization.k8s.io" },
            subjects: [{ kind: "ServiceAccount", name: "normal-sa" }],
          },
        ],
      },
    });

    mockReadNamespacedRole.mockResolvedValue({
      body: {
        rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }],
      },
    });

    const result = await handleK8sRbac({ action: "audit_sa", namespace: "default" });
    expect(result).toContain("admin-sa");
    expect(result).toContain("HIGH");
    expect(result).toContain("wildcard");
    expect(result).not.toContain("normal-sa");
  });

  it("audit_sa returns no results when all SAs are clean", async () => {
    mockListNamespacedServiceAccount.mockResolvedValue({
      body: {
        items: [
          { metadata: { name: "clean-sa", namespace: "default" } },
        ],
      },
    });

    mockListClusterRoleBinding.mockResolvedValue({ body: { items: [] } });
    mockListNamespacedRoleBinding.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sRbac({ action: "audit_sa", namespace: "default" });
    expect(result).toContain("No overprivileged ServiceAccounts found");
  });
});
