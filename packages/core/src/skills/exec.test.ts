import { describe, it, expect } from "vitest";
import { K8sExecSchema, buildExecCommand } from "./exec.js";

describe("K8sExecSchema validation", () => {
  it("accepts valid exec params", () => {
    const result = K8sExecSchema.safeParse({
      action: "exec",
      pod_name: "test-pod",
      command: "ls",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid action", () => {
    const result = K8sExecSchema.safeParse({
      action: "invalid",
      pod_name: "test-pod",
    });
    expect(result.success).toBe(false);
  });

  it("requires pod_name", () => {
    const result = K8sExecSchema.safeParse({ action: "env" });
    expect(result.success).toBe(false);
  });

  it("defaults namespace to 'default'", () => {
    const result = K8sExecSchema.parse({ action: "env", pod_name: "test" });
    expect(result.namespace).toBe("default");
  });

  it("defaults directory to '/'", () => {
    const result = K8sExecSchema.parse({ action: "file_list", pod_name: "test" });
    expect(result.directory).toBe("/");
  });

  it("rejects target_host with shell metacharacters", () => {
    const result = K8sExecSchema.safeParse({
      action: "network_check",
      pod_name: "test-pod",
      target_host: "8.8.8.8; rm -rf /",
    });
    expect(result.success).toBe(false);
  });

  it("rejects target_host with command substitution", () => {
    const result = K8sExecSchema.safeParse({
      action: "network_check",
      pod_name: "test-pod",
      target_host: "$(whoami).evil.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects target_host with backtick command substitution", () => {
    const result = K8sExecSchema.safeParse({
      action: "network_check",
      pod_name: "test-pod",
      target_host: "`whoami`.evil.com",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid hostname", () => {
    const result = K8sExecSchema.safeParse({
      action: "network_check",
      pod_name: "test-pod",
      target_host: "my-service.default.svc.cluster.local",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid IP address", () => {
    const result = K8sExecSchema.safeParse({
      action: "network_check",
      pod_name: "test-pod",
      target_host: "10.0.0.1",
    });
    expect(result.success).toBe(true);
  });
});

describe("buildExecCommand", () => {
  it("builds exec command with sh -c", () => {
    const cmd = buildExecCommand({
      action: "exec",
      namespace: "default",
      pod_name: "test",
      directory: "/",
      command: "ls -la",
    });
    expect(cmd).toEqual(["sh", "-c", "ls -la"]);
  });

  it("throws when exec action missing command", () => {
    expect(() =>
      buildExecCommand({
        action: "exec",
        namespace: "default",
        pod_name: "test",
        directory: "/",
      })
    ).toThrow("command is required");
  });

  it("builds file_read command", () => {
    const cmd = buildExecCommand({
      action: "file_read",
      namespace: "default",
      pod_name: "test",
      directory: "/",
      file_path: "/etc/hosts",
    });
    expect(cmd).toEqual(["cat", "/etc/hosts"]);
  });

  it("builds file_list command with directory", () => {
    const cmd = buildExecCommand({
      action: "file_list",
      namespace: "default",
      pod_name: "test",
      directory: "/var/log",
    });
    expect(cmd).toEqual(["ls", "-la", "/var/log"]);
  });

  it("builds env command", () => {
    const cmd = buildExecCommand({
      action: "env",
      namespace: "default",
      pod_name: "test",
      directory: "/",
    });
    expect(cmd).toEqual(["env"]);
  });

  it("network_check passes host and port as positional args", () => {
    const cmd = buildExecCommand({
      action: "network_check",
      namespace: "default",
      pod_name: "test",
      directory: "/",
      target_host: "my-service",
      target_port: 8080,
    });
    expect(cmd[0]).toBe("sh");
    expect(cmd[1]).toBe("-c");
    // Host and port are passed as positional args, not interpolated
    expect(cmd[3]).toBe("my-service");
    expect(cmd[4]).toBe("8080");
    // The script uses $0 and $1 references
    expect(cmd[2]).toContain("$0");
    expect(cmd[2]).toContain("$1");
    // The script should NOT contain the literal host value
    expect(cmd[2]).not.toContain("my-service");
  });

  it("network_check defaults port to 80", () => {
    const cmd = buildExecCommand({
      action: "network_check",
      namespace: "default",
      pod_name: "test",
      directory: "/",
      target_host: "example.com",
    });
    expect(cmd[4]).toBe("80");
  });

  it("throws when network_check missing target_host", () => {
    expect(() =>
      buildExecCommand({
        action: "network_check",
        namespace: "default",
        pod_name: "test",
        directory: "/",
      })
    ).toThrow("target_host is required");
  });
});
