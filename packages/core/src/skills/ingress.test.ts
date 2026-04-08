import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sIngressSchema } from "./ingress.js";

// Mock createK8sClients before importing handler
const mockReadNamespacedIngress = vi.fn();
const mockReplaceNamespacedIngress = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    networkingApi: {
      readNamespacedIngress: mockReadNamespacedIngress,
      replaceNamespacedIngress: mockReplaceNamespacedIngress,
      listNamespacedIngress: vi.fn(),
      listIngressForAllNamespaces: vi.fn(),
      deleteNamespacedIngress: vi.fn(),
    },
  }),
}));

const { handleK8sIngress } = await import("./ingress.js");

describe("K8sIngressSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sIngressSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts string service_port in rules", () => {
    const result = K8sIngressSchema.safeParse({
      action: "update",
      ingress_name: "test",
      rules: [{
        host: "example.com",
        paths: [{ path: "/", service: "web", service_port: "http" }],
      }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts numeric service_port in rules", () => {
    const result = K8sIngressSchema.safeParse({
      action: "update",
      ingress_name: "test",
      rules: [{
        host: "example.com",
        paths: [{ path: "/", service: "web", service_port: 8080 }],
      }],
    });
    expect(result.success).toBe(true);
  });
});

describe("handleK8sIngress update - port handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadNamespacedIngress.mockResolvedValue({
      body: {
        metadata: { name: "test-ingress", namespace: "default" },
        spec: { rules: [] },
      },
    });
    mockReplaceNamespacedIngress.mockResolvedValue({});
  });

  it("uses port.number for numeric service_port", async () => {
    await handleK8sIngress({
      action: "update",
      ingress_name: "test-ingress",
      rules: [{
        host: "example.com",
        paths: [{ path: "/", service: "web-svc", service_port: 8080 }],
      }],
    });

    const [, , updatedIngress] = mockReplaceNamespacedIngress.mock.calls[0];
    const backend = updatedIngress.spec.rules[0].http.paths[0].backend;

    expect(backend.service.name).toBe("web-svc");
    expect(backend.service.port).toEqual({ number: 8080 });
    expect(backend.service.port.name).toBeUndefined();
  });

  it("uses port.name for string service_port", async () => {
    await handleK8sIngress({
      action: "update",
      ingress_name: "test-ingress",
      rules: [{
        host: "example.com",
        paths: [{ path: "/api", service: "api-svc", service_port: "http" }],
      }],
    });

    const [, , updatedIngress] = mockReplaceNamespacedIngress.mock.calls[0];
    const backend = updatedIngress.spec.rules[0].http.paths[0].backend;

    expect(backend.service.name).toBe("api-svc");
    expect(backend.service.port).toEqual({ name: "http" });
    expect(backend.service.port.number).toBeUndefined();
  });

  it("does NOT coerce string port to 80", async () => {
    await handleK8sIngress({
      action: "update",
      ingress_name: "test-ingress",
      rules: [{
        host: "example.com",
        paths: [{ path: "/", service: "svc", service_port: "metrics" }],
      }],
    });

    const [, , updatedIngress] = mockReplaceNamespacedIngress.mock.calls[0];
    const port = updatedIngress.spec.rules[0].http.paths[0].backend.service.port;

    expect(port.number).toBeUndefined();
    expect(port.name).toBe("metrics");
  });

  it("handles multiple paths with mixed port types", async () => {
    await handleK8sIngress({
      action: "update",
      ingress_name: "test-ingress",
      rules: [{
        host: "example.com",
        paths: [
          { path: "/web", service: "web-svc", service_port: 80 },
          { path: "/api", service: "api-svc", service_port: "grpc" },
        ],
      }],
    });

    const [, , updatedIngress] = mockReplaceNamespacedIngress.mock.calls[0];
    const paths = updatedIngress.spec.rules[0].http.paths;

    expect(paths[0].backend.service.port).toEqual({ number: 80 });
    expect(paths[1].backend.service.port).toEqual({ name: "grpc" });
  });

  it("sets pathType to Prefix for all paths", async () => {
    await handleK8sIngress({
      action: "update",
      ingress_name: "test-ingress",
      rules: [{
        host: "example.com",
        paths: [{ path: "/", service: "svc", service_port: 80 }],
      }],
    });

    const [, , updatedIngress] = mockReplaceNamespacedIngress.mock.calls[0];
    expect(updatedIngress.spec.rules[0].http.paths[0].pathType).toBe("Prefix");
  });

  it("updates TLS when provided", async () => {
    await handleK8sIngress({
      action: "update",
      ingress_name: "test-ingress",
      tls: [{
        hosts: ["example.com"],
        secret_name: "tls-secret",
      }],
    });

    const [, , updatedIngress] = mockReplaceNamespacedIngress.mock.calls[0];
    expect(updatedIngress.spec.tls).toEqual([{
      hosts: ["example.com"],
      secretName: "tls-secret",
    }]);
  });
});
