import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sGatewaySchema } from "./gateway.js";

const mockListNamespacedCustomObject = vi.fn();
const mockListClusterCustomObject = vi.fn();
const mockGetNamespacedCustomObject = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    customObjectsApi: {
      listNamespacedCustomObject: mockListNamespacedCustomObject,
      listClusterCustomObject: mockListClusterCustomObject,
      getNamespacedCustomObject: mockGetNamespacedCustomObject,
    },
  }),
}));

const { handleK8sGateway } = await import("./gateway.js");

function makeGateway(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metadata: {
      name: "api-gateway",
      namespace: "production",
      creationTimestamp: "2026-03-01T00:00:00Z",
    },
    spec: {
      gatewayClassName: "istio",
      listeners: [
        { name: "http", port: 80, protocol: "HTTP", allowedRoutes: { namespaces: { from: "Same" } } },
        {
          name: "https",
          port: 443,
          protocol: "HTTPS",
          tls: { certificateRefs: [{ name: "api-tls", kind: "Secret" }] },
          allowedRoutes: { namespaces: { from: "All" } },
        },
      ],
    },
    status: {
      addresses: [{ value: "203.0.113.1" }],
      conditions: [
        { type: "Accepted", status: "True", reason: "Accepted" },
        { type: "Programmed", status: "True", reason: "Programmed" },
      ],
      listeners: [
        { name: "http", attachedRoutes: 3, conditions: [{ type: "Accepted", status: "True" }] },
        { name: "https", attachedRoutes: 3, conditions: [{ type: "Accepted", status: "True" }] },
      ],
    },
    ...overrides,
  };
}

function makeHTTPRoute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metadata: {
      name: "web-route",
      namespace: "production",
      creationTimestamp: "2026-03-02T00:00:00Z",
    },
    spec: {
      parentRefs: [{ name: "api-gateway", sectionName: "http" }],
      hostnames: ["app.example.com"],
      rules: [
        {
          matches: [{ path: { type: "PathPrefix", value: "/api" } }],
          backendRefs: [{ name: "api-svc", port: 8080, weight: 100 }],
        },
        {
          matches: [{ path: { type: "PathPrefix", value: "/" } }],
          backendRefs: [
            { name: "frontend-svc", port: 3000, weight: 90 },
            { name: "frontend-canary", port: 3000, weight: 10 },
          ],
        },
      ],
    },
    status: {
      parents: [
        {
          parentRef: { name: "api-gateway" },
          conditions: [
            { type: "Accepted", status: "True", reason: "Accepted" },
            { type: "ResolvedRefs", status: "True", reason: "ResolvedRefs" },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe("K8sGatewaySchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sGatewaySchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list_gateways", "describe_gateway", "list_routes", "describe_route", "list_classes", "status"];
    for (const action of actions) {
      const result = K8sGatewaySchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });

  it("accepts optional route_type", () => {
    const result = K8sGatewaySchema.safeParse({ action: "list_routes", route_type: "GRPCRoute" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid route_type", () => {
    const result = K8sGatewaySchema.safeParse({ action: "list_routes", route_type: "UnknownRoute" });
    expect(result.success).toBe(false);
  });
});

describe("handleK8sGateway list_gateways", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("formats gateway list with addresses and listeners", async () => {
    mockListNamespacedCustomObject.mockResolvedValue({
      body: { items: [makeGateway()] },
    });

    const result = await handleK8sGateway({ action: "list_gateways", namespace: "production" });
    expect(result).toContain("api-gateway");
    expect(result).toContain("istio");
    expect(result).toContain("203.0.113.1");
    expect(result).toContain("2");
    expect(result).toContain("NAMESPACE");
  });

  it("returns empty message when no gateways", async () => {
    mockListNamespacedCustomObject.mockResolvedValue({
      body: { items: [] },
    });

    const result = await handleK8sGateway({ action: "list_gateways" });
    expect(result).toContain("No Gateways found");
  });

  it("uses cluster-wide listing when all_namespaces", async () => {
    mockListClusterCustomObject.mockResolvedValue({
      body: { items: [] },
    });

    await handleK8sGateway({ action: "list_gateways", all_namespaces: true });
    expect(mockListClusterCustomObject).toHaveBeenCalled();
    expect(mockListNamespacedCustomObject).not.toHaveBeenCalled();
  });

  it("handles Gateway API not installed gracefully", async () => {
    const error = { response: { statusCode: 404, body: {} } };
    mockListNamespacedCustomObject.mockRejectedValue(error);

    const result = await handleK8sGateway({ action: "list_gateways" });
    expect(result).toContain("Gateway API is not installed");
  });
});

describe("handleK8sGateway describe_gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows listeners with TLS and attached routes", async () => {
    mockGetNamespacedCustomObject.mockResolvedValue({
      body: makeGateway(),
    });

    const result = await handleK8sGateway({
      action: "describe_gateway",
      name: "api-gateway",
      namespace: "production",
    });
    expect(result).toContain("Gateway: production/api-gateway");
    expect(result).toContain("Class: istio");
    expect(result).toContain("203.0.113.1");
    expect(result).toContain("http (port 80, HTTP)");
    expect(result).toContain("https (port 443, HTTPS)");
    expect(result).toContain("TLS: Secret/api-tls");
    expect(result).toContain("Attached Routes: 3");
    expect(result).toContain("Allowed Routes: Same namespace");
    expect(result).toContain("Allowed Routes: All namespace");
  });

  it("requires name", async () => {
    await expect(
      handleK8sGateway({ action: "describe_gateway" })
    ).rejects.toThrow("name is required");
  });
});

describe("handleK8sGateway list_routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists HTTPRoutes with hostnames and parents", async () => {
    mockListNamespacedCustomObject.mockResolvedValue({
      body: { items: [makeHTTPRoute()] },
    });

    const result = await handleK8sGateway({ action: "list_routes", namespace: "production" });
    expect(result).toContain("web-route");
    expect(result).toContain("app.example.com");
    expect(result).toContain("api-gateway");
    expect(result).toContain("NAMESPACE");
  });

  it("defaults to HTTPRoute when route_type omitted", async () => {
    mockListNamespacedCustomObject.mockResolvedValue({
      body: { items: [] },
    });

    await handleK8sGateway({ action: "list_routes" });
    expect(mockListNamespacedCustomObject).toHaveBeenCalledWith(
      "gateway.networking.k8s.io", "v1", "default", "httproutes",
      undefined, undefined, undefined, undefined, undefined
    );
  });

  it("handles different route types", async () => {
    mockListNamespacedCustomObject.mockResolvedValue({
      body: { items: [] },
    });

    await handleK8sGateway({ action: "list_routes", route_type: "GRPCRoute" });
    expect(mockListNamespacedCustomObject).toHaveBeenCalledWith(
      "gateway.networking.k8s.io", "v1", "default", "grpcroutes",
      undefined, undefined, undefined, undefined, undefined
    );
  });

  it("returns empty for no routes", async () => {
    mockListNamespacedCustomObject.mockResolvedValue({
      body: { items: [] },
    });

    const result = await handleK8sGateway({ action: "list_routes" });
    expect(result).toContain("No HTTPRoutes found");
  });
});

describe("handleK8sGateway describe_route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows rules with matches, backends, and status", async () => {
    mockGetNamespacedCustomObject.mockResolvedValue({
      body: makeHTTPRoute(),
    });

    const result = await handleK8sGateway({
      action: "describe_route",
      name: "web-route",
      namespace: "production",
    });
    expect(result).toContain("HTTPRoute: production/web-route");
    expect(result).toContain("app.example.com");
    expect(result).toContain("api-gateway");
    expect(result).toContain("/api");
    expect(result).toContain("api-svc:8080");
    expect(result).toContain("frontend-svc:3000");
    expect(result).toContain("weight: 90");
    expect(result).toContain("weight: 10");
    expect(result).toContain("Accepted");
    expect(result).toContain("ResolvedRefs");
  });

  it("requires name", async () => {
    await expect(
      handleK8sGateway({ action: "describe_route" })
    ).rejects.toThrow("name is required");
  });
});

describe("handleK8sGateway list_classes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists gateway classes with controller and accepted status", async () => {
    mockListClusterCustomObject.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "istio", creationTimestamp: "2026-01-01T00:00:00Z" },
            spec: { controllerName: "istio.io/gateway-controller", description: "Istio Gateway" },
            status: { conditions: [{ type: "Accepted", status: "True", reason: "Accepted" }] },
          },
          {
            metadata: { name: "envoy", creationTimestamp: "2026-02-01T00:00:00Z" },
            spec: { controllerName: "gateway.envoyproxy.io/gatewayclass-controller" },
            status: { conditions: [{ type: "Accepted", status: "False", reason: "InvalidParameters" }] },
          },
        ],
      },
    });

    const result = await handleK8sGateway({ action: "list_classes" });
    expect(result).toContain("istio");
    expect(result).toContain("envoy");
    expect(result).toContain("istio.io/gateway-controller");
    expect(result).toContain("Istio Gateway");
    expect(result).toContain("CONTROLLER");
    expect(result).toContain("ACCEPTED");
  });

  it("returns empty message", async () => {
    mockListClusterCustomObject.mockResolvedValue({
      body: { items: [] },
    });

    const result = await handleK8sGateway({ action: "list_classes" });
    expect(result).toContain("No GatewayClasses found");
  });
});

describe("handleK8sGateway status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates gateway and route health", async () => {
    mockListNamespacedCustomObject
      .mockResolvedValueOnce({ body: { items: [makeGateway()] } })
      .mockResolvedValueOnce({ body: { items: [makeHTTPRoute()] } });

    const result = await handleK8sGateway({ action: "status", namespace: "production" });
    expect(result).toContain("Gateway API Status");
    expect(result).toContain("Gateways: 1");
    expect(result).toContain("Routes: 1");
    expect(result).toContain("api-gateway");
    expect(result).toContain("Accepted");
    expect(result).toContain("Programmed");
    expect(result).toContain("web-route");
  });

  it("handles Gateway API not installed", async () => {
    const error = { response: { statusCode: 404, body: {} } };
    mockListNamespacedCustomObject.mockRejectedValue(error);

    const result = await handleK8sGateway({ action: "status" });
    expect(result).toContain("Gateway API is not installed");
  });
});
