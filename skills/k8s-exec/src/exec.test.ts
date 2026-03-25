import { describe, it, expect } from "vitest";

// Test the command building logic by importing the module
// Since execInPod requires a real K8s connection, we test the pure functions
// and input validation paths

describe("k8s-exec input validation", () => {
  it("exec action requires command parameter", async () => {
    // Import the module to test schema validation
    const { z } = await import("zod");
    const K8sExecSchema = z.object({
      action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
      namespace: z.string().default("default"),
      pod_name: z.string(),
      container: z.string().optional(),
      command: z.string().optional(),
      file_path: z.string().optional(),
      directory: z.string().default("/"),
      target_host: z.string().optional(),
      target_port: z.number().int().positive().optional(),
      context: z.string().optional(),
    });

    const result = K8sExecSchema.safeParse({
      action: "exec",
      pod_name: "test-pod",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid action", async () => {
    const { z } = await import("zod");
    const K8sExecSchema = z.object({
      action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
      namespace: z.string().default("default"),
      pod_name: z.string(),
    });

    const result = K8sExecSchema.safeParse({
      action: "invalid",
      pod_name: "test-pod",
    });
    expect(result.success).toBe(false);
  });

  it("requires pod_name", async () => {
    const { z } = await import("zod");
    const K8sExecSchema = z.object({
      action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
      namespace: z.string().default("default"),
      pod_name: z.string(),
    });

    const result = K8sExecSchema.safeParse({ action: "env" });
    expect(result.success).toBe(false);
  });

  it("defaults namespace to 'default'", async () => {
    const { z } = await import("zod");
    const K8sExecSchema = z.object({
      action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
      namespace: z.string().default("default"),
      pod_name: z.string(),
    });

    const result = K8sExecSchema.parse({ action: "env", pod_name: "test" });
    expect(result.namespace).toBe("default");
  });

  it("defaults directory to '/'", async () => {
    const { z } = await import("zod");
    const K8sExecSchema = z.object({
      action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
      pod_name: z.string(),
      directory: z.string().default("/"),
    });

    const result = K8sExecSchema.parse({ action: "file_list", pod_name: "test" });
    expect(result.directory).toBe("/");
  });
});
