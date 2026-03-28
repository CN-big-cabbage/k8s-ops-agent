import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sCrdSchema } from "./crd.js";

const mockListCustomResourceDefinition = vi.fn();
const mockReadCustomResourceDefinition = vi.fn();
const mockListClusterCustomObject = vi.fn();
const mockListNamespacedCustomObject = vi.fn();
const mockGetClusterCustomObject = vi.fn();
const mockGetNamespacedCustomObject = vi.fn();
const mockDeleteClusterCustomObject = vi.fn();
const mockDeleteNamespacedCustomObject = vi.fn();

vi.mock("../../../lib/client.js", () => ({
  createK8sClients: () => ({
    apiextensionsApi: {
      listCustomResourceDefinition: mockListCustomResourceDefinition,
      readCustomResourceDefinition: mockReadCustomResourceDefinition,
    },
    customObjectsApi: {
      listClusterCustomObject: mockListClusterCustomObject,
      listNamespacedCustomObject: mockListNamespacedCustomObject,
      getClusterCustomObject: mockGetClusterCustomObject,
      getNamespacedCustomObject: mockGetNamespacedCustomObject,
      deleteClusterCustomObject: mockDeleteClusterCustomObject,
      deleteNamespacedCustomObject: mockDeleteNamespacedCustomObject,
    },
  }),
}));

const { handleK8sCrd } = await import("./crd.js");

describe("K8sCrdSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sCrdSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list_definitions", "describe_definition", "list_resources", "describe_resource", "delete_resource"];
    for (const action of actions) {
      const result = K8sCrdSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

const mockCrd = {
  metadata: { name: "certificates.cert-manager.io", creationTimestamp: new Date() },
  spec: {
    group: "cert-manager.io",
    scope: "Namespaced",
    names: { plural: "certificates", singular: "certificate", kind: "Certificate" },
    versions: [
      {
        name: "v1",
        served: true,
        storage: true,
        additionalPrinterColumns: [
          { name: "Ready", type: "string", jsonPath: ".status.conditions[0].status" },
        ],
        schema: {
          openAPIV3Schema: {
            type: "object",
            properties: {
              spec: {
                type: "object",
                properties: {
                  secretName: { type: "string", description: "Name of the secret to store the cert" },
                  issuerRef: { type: "object", properties: { name: { type: "string" } } },
                },
              },
            },
          },
        },
      },
    ],
  },
  status: {
    conditions: [{ type: "Established", status: "True", reason: "InitialNamesAccepted" }],
  },
};

describe("handleK8sCrd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list_definitions returns formatted table", async () => {
    mockListCustomResourceDefinition.mockResolvedValue({
      body: { items: [mockCrd] },
    });

    const result = await handleK8sCrd({ action: "list_definitions" });
    expect(result).toContain("certificates.cert-manager.io");
    expect(result).toContain("cert-manager.io");
    expect(result).toContain("v1");
    expect(result).toContain("Namespaced");
    expect(result).toContain("True");
  });

  it("list_definitions returns empty message", async () => {
    mockListCustomResourceDefinition.mockResolvedValue({
      body: { items: [] },
    });

    const result = await handleK8sCrd({ action: "list_definitions" });
    expect(result).toContain("No CustomResourceDefinitions found");
  });

  it("describe_definition shows CRD details", async () => {
    mockReadCustomResourceDefinition.mockResolvedValue({
      body: mockCrd,
    });

    const result = await handleK8sCrd({
      action: "describe_definition",
      crd_name: "certificates.cert-manager.io",
    });
    expect(result).toContain("certificates.cert-manager.io");
    expect(result).toContain("cert-manager.io");
    expect(result).toContain("Namespaced");
    expect(result).toContain("v1");
    expect(result).toContain("Served");
    expect(result).toContain("Storage");
    expect(result).toContain("secretName");
  });

  it("describe_definition requires crd_name", async () => {
    await expect(
      handleK8sCrd({ action: "describe_definition" })
    ).rejects.toThrow("crd_name is required");
  });

  it("list_resources with group/version/plural", async () => {
    mockListNamespacedCustomObject.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "my-cert", namespace: "default", creationTimestamp: new Date().toISOString() },
            spec: { secretName: "my-tls" },
            status: { conditions: [{ status: "True" }] },
          },
        ],
      },
    });

    const result = await handleK8sCrd({
      action: "list_resources",
      group: "cert-manager.io",
      version: "v1",
      plural: "certificates",
      namespace: "default",
    });
    expect(result).toContain("my-cert");
    expect(result).toContain("default");
  });

  it("list_resources auto-resolves from crd_name", async () => {
    mockReadCustomResourceDefinition.mockResolvedValue({ body: mockCrd });
    mockListNamespacedCustomObject.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "my-cert", namespace: "default", creationTimestamp: new Date().toISOString() },
          },
        ],
      },
    });

    const result = await handleK8sCrd({
      action: "list_resources",
      crd_name: "certificates.cert-manager.io",
    });
    expect(result).toContain("my-cert");
  });

  it("list_resources uses cluster API for Cluster-scoped CRDs", async () => {
    const clusterCrd = {
      ...mockCrd,
      spec: { ...mockCrd.spec, scope: "Cluster" },
    };
    mockReadCustomResourceDefinition.mockResolvedValue({ body: clusterCrd });
    mockListClusterCustomObject.mockResolvedValue({
      body: { items: [] },
    });

    const result = await handleK8sCrd({
      action: "list_resources",
      crd_name: "certificates.cert-manager.io",
    });
    expect(result).toContain("No custom resources found");
    expect(mockListClusterCustomObject).toHaveBeenCalled();
    expect(mockListNamespacedCustomObject).not.toHaveBeenCalled();
  });

  it("describe_resource shows CR details", async () => {
    mockGetNamespacedCustomObject.mockResolvedValue({
      body: {
        metadata: {
          name: "my-cert",
          namespace: "default",
          creationTimestamp: new Date().toISOString(),
          labels: { app: "web" },
        },
        spec: { secretName: "my-tls", issuerRef: { name: "letsencrypt" } },
        status: { ready: true },
      },
    });

    const result = await handleK8sCrd({
      action: "describe_resource",
      group: "cert-manager.io",
      version: "v1",
      plural: "certificates",
      resource_name: "my-cert",
    });
    expect(result).toContain("my-cert");
    expect(result).toContain("my-tls");
    expect(result).toContain("letsencrypt");
    expect(result).toContain("app: web");
  });

  it("describe_resource requires resource_name", async () => {
    await expect(
      handleK8sCrd({
        action: "describe_resource",
        group: "cert-manager.io",
        version: "v1",
        plural: "certificates",
      })
    ).rejects.toThrow("resource_name is required");
  });

  it("delete_resource removes CR", async () => {
    mockDeleteNamespacedCustomObject.mockResolvedValue({});

    const result = await handleK8sCrd({
      action: "delete_resource",
      group: "cert-manager.io",
      version: "v1",
      plural: "certificates",
      resource_name: "my-cert",
    });
    expect(result).toContain("my-cert");
    expect(result).toContain("deleted");
  });

  it("delete_resource requires resource_name", async () => {
    await expect(
      handleK8sCrd({
        action: "delete_resource",
        group: "cert-manager.io",
        version: "v1",
        plural: "certificates",
      })
    ).rejects.toThrow("resource_name is required");
  });

  it("requires either crd_name or group/version/plural for resource ops", async () => {
    await expect(
      handleK8sCrd({
        action: "list_resources",
      })
    ).rejects.toThrow("Either crd_name or group/version/plural are required");
  });
});
