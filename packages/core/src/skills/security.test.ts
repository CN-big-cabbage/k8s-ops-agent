import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sSecuritySchema } from "./security.js";

const mockListNamespacedPod = vi.fn();
const mockListPodForAllNamespaces = vi.fn();
const mockListNamespacedSecret = vi.fn();
const mockListSecretForAllNamespaces = vi.fn();
const mockListNamespacedNetworkPolicy = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    coreApi: {
      listNamespacedPod: mockListNamespacedPod,
      listPodForAllNamespaces: mockListPodForAllNamespaces,
      listNamespacedSecret: mockListNamespacedSecret,
      listSecretForAllNamespaces: mockListSecretForAllNamespaces,
    },
    networkingApi: {
      listNamespacedNetworkPolicy: mockListNamespacedNetworkPolicy,
    },
  }),
}));

const { handleK8sSecurity } = await import("./security.js");

describe("K8sSecuritySchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sSecuritySchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["scan_namespace", "check_psa", "secret_audit", "image_audit", "privileged_pods"];
    for (const action of actions) {
      const result = K8sSecuritySchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sSecurity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- scan_namespace ---

  it("scan_namespace produces scored report", async () => {
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "priv-pod", namespace: "default" },
            spec: {
              containers: [
                {
                  name: "app",
                  image: "nginx:latest",
                  securityContext: { privileged: true },
                },
              ],
            },
          },
          {
            metadata: { name: "normal-pod", namespace: "default" },
            spec: {
              containers: [
                { name: "app", image: "registry.io/app:v1.2.3" },
              ],
            },
          },
        ],
      },
    });

    mockListNamespacedSecret.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "unused-secret", namespace: "default" },
            type: "Opaque",
          },
        ],
      },
    });

    mockListNamespacedNetworkPolicy.mockResolvedValue({
      body: { items: [] },
    });

    const result = await handleK8sSecurity({ action: "scan_namespace", namespace: "default" });
    expect(result).toContain("Security Report: default");
    expect(result).toContain("Score:");
    expect(result).toContain("[HIGH]");
    expect(result).toContain("privileged pods");
    expect(result).toContain(":latest");
    expect(result).toContain("[MEDIUM]");
    expect(result).toContain("unused secrets");
    expect(result).toContain("Recommendations");
  });

  it("scan_namespace with no issues returns 100 score", async () => {
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "good-pod", namespace: "default" },
            spec: {
              containers: [
                { name: "app", image: "registry.io/app:v1.0.0" },
              ],
            },
          },
        ],
      },
    });

    mockListNamespacedSecret.mockResolvedValue({
      body: { items: [] },
    });

    mockListNamespacedNetworkPolicy.mockResolvedValue({
      body: { items: [{ metadata: { name: "np1" } }] },
    });

    const result = await handleK8sSecurity({ action: "scan_namespace", namespace: "default" });
    expect(result).toContain("Score: 100/100");
    expect(result).toContain("No issues found.");
  });

  // --- check_psa ---

  it("check_psa correctly classifies pods", async () => {
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "privileged-pod" },
            spec: {
              hostPID: true,
              containers: [
                {
                  name: "app",
                  securityContext: { privileged: true },
                },
              ],
            },
          },
          {
            metadata: { name: "baseline-pod" },
            spec: {
              containers: [
                {
                  name: "app",
                  securityContext: {
                    capabilities: { add: ["NET_ADMIN"] },
                  },
                },
              ],
              volumes: [{ name: "host-vol", hostPath: { path: "/data" } }],
            },
          },
          {
            metadata: { name: "restricted-pod" },
            spec: {
              securityContext: {
                runAsNonRoot: true,
                seccompProfile: { type: "RuntimeDefault" },
              },
              containers: [
                {
                  name: "app",
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    readOnlyRootFilesystem: true,
                    capabilities: { drop: ["ALL"] },
                  },
                },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sSecurity({ action: "check_psa", namespace: "default" });
    expect(result).toContain("privileged-pod");
    expect(result).toContain("privileged");
    expect(result).toContain("baseline-pod");
    expect(result).toContain("baseline");
    expect(result).toContain("restricted-pod");
  });

  // --- secret_audit ---

  it("secret_audit finds unused secrets", async () => {
    mockListNamespacedSecret.mockResolvedValue({
      body: {
        items: [
          { metadata: { name: "used-secret", namespace: "default" }, type: "Opaque" },
          { metadata: { name: "orphaned-secret", namespace: "default" }, type: "Opaque" },
          {
            metadata: { name: "sa-token", namespace: "default" },
            type: "kubernetes.io/service-account-token",
          },
        ],
      },
    });

    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web", namespace: "default" },
            spec: {
              containers: [
                {
                  name: "app",
                  env: [
                    {
                      name: "DB_PASS",
                      valueFrom: { secretKeyRef: { name: "used-secret", key: "password" } },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sSecurity({ action: "secret_audit", namespace: "default" });
    expect(result).toContain("used-secret");
    expect(result).toContain("used");
    expect(result).toContain("orphaned-secret");
    expect(result).toContain("unused");
    // SA token should be filtered out
    expect(result).not.toContain("sa-token");
  });

  // --- image_audit ---

  it("image_audit flags :latest and missing registry", async () => {
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "bad-pod" },
            spec: {
              containers: [
                { name: "web", image: "nginx:latest" },
                { name: "sidecar", image: "busybox" },
              ],
            },
          },
          {
            metadata: { name: "good-pod" },
            spec: {
              containers: [
                { name: "app", image: "registry.io/myapp:v1.2.3" },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sSecurity({ action: "image_audit", namespace: "default" });
    expect(result).toContain("nginx:latest");
    expect(result).toContain(":latest");
    expect(result).toContain("busybox");
    expect(result).toContain("no registry");
    expect(result).not.toContain("myapp:v1.2.3");
  });

  it("image_audit returns no issues for clean images", async () => {
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "good-pod" },
            spec: {
              containers: [
                { name: "app", image: "gcr.io/myproject/app:v1.0.0" },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sSecurity({ action: "image_audit", namespace: "default" });
    expect(result).toContain("No image issues found");
  });

  // --- privileged_pods ---

  it("privileged_pods detects all risk flags", async () => {
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "risky-pod", namespace: "default" },
            spec: {
              hostNetwork: true,
              hostPID: true,
              securityContext: { runAsUser: 0 },
              containers: [
                {
                  name: "app",
                  securityContext: { privileged: true, runAsUser: 0 },
                },
              ],
            },
          },
          {
            metadata: { name: "safe-pod", namespace: "default" },
            spec: {
              containers: [
                {
                  name: "app",
                  securityContext: { runAsNonRoot: true },
                },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sSecurity({ action: "privileged_pods", namespace: "default" });
    expect(result).toContain("risky-pod");
    expect(result).toContain("hostNetwork");
    expect(result).toContain("hostPID");
    expect(result).toContain("privileged");
    expect(result).toContain("runAsRoot");
    expect(result).not.toContain("safe-pod");
  });

  it("privileged_pods returns empty when no risky pods", async () => {
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "safe", namespace: "default" },
            spec: {
              containers: [{ name: "app", securityContext: {} }],
            },
          },
        ],
      },
    });

    const result = await handleK8sSecurity({ action: "privileged_pods", namespace: "default" });
    expect(result).toContain("No privileged pods found");
  });

  it("privileged_pods all namespaces", async () => {
    mockListPodForAllNamespaces.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "priv-pod", namespace: "kube-system" },
            spec: {
              hostNetwork: true,
              containers: [
                { name: "proxy", securityContext: { privileged: true } },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sSecurity({ action: "privileged_pods", all_namespaces: true });
    expect(result).toContain("priv-pod");
    expect(result).toContain("kube-system");
  });
});
