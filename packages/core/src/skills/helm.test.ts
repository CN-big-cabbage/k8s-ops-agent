import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sHelmSchema } from "./helm.js";

const mockExecFile = vi.fn();

vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock("util", () => ({
  promisify: (fn: unknown) => (...args: unknown[]) => {
    return (fn as Function)(...args);
  },
}));

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({}),
}));

const { handleK8sHelm, execHelm } = await import("./helm.js");

function mockStdout(stdout: string) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown) =>
      Promise.resolve({ stdout })
  );
}

function mockStdoutSequence(outputs: string[]) {
  let callIndex = 0;
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown) => {
      const stdout = outputs[callIndex] || "";
      callIndex++;
      return Promise.resolve({ stdout });
    }
  );
}

describe("K8sHelmSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sHelmSchema.safeParse({ action: "install" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list", "status", "history", "values", "diff", "rollback", "uninstall"];
    for (const action of actions) {
      const result = K8sHelmSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });

  it("accepts optional parameters", () => {
    const result = K8sHelmSchema.safeParse({
      action: "status",
      release_name: "nginx",
      namespace: "default",
      revision: 3,
    });
    expect(result.success).toBe(true);
  });
});

describe("execHelm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles helm not installed (ENOENT)", async () => {
    const error = new Error("spawn helm ENOENT") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    mockExecFile.mockRejectedValue(error);

    await expect(execHelm(["list"])).rejects.toThrow("helm CLI not found");
  });

  it("surfaces helm stderr messages", async () => {
    const error = Object.assign(new Error("command failed"), {
      stderr: "Error: release not found",
    });
    mockExecFile.mockRejectedValue(error);

    await expect(execHelm(["status", "nonexistent"])).rejects.toThrow(
      "helm error: Error: release not found"
    );
  });
});

describe("handleK8sHelm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list parses helm JSON and formats table", async () => {
    const releases = [
      {
        name: "nginx",
        namespace: "default",
        revision: "3",
        updated: "2026-03-20 10:00:00",
        status: "deployed",
        chart: "nginx-15.0.0",
        app_version: "1.25.0",
      },
      {
        name: "redis",
        namespace: "cache",
        revision: "1",
        updated: "2026-03-19 08:00:00",
        status: "deployed",
        chart: "redis-18.0.0",
        app_version: "7.2.0",
      },
    ];
    mockStdout(JSON.stringify(releases));

    const result = await handleK8sHelm({ action: "list" });
    expect(result).toContain("nginx");
    expect(result).toContain("redis");
    expect(result).toContain("default");
    expect(result).toContain("cache");
    expect(result).toContain("deployed");
    expect(result).toContain("NAMESPACE");
    expect(result).toContain("NAME");
  });

  it("list returns empty message when no releases", async () => {
    mockStdout("[]");

    const result = await handleK8sHelm({ action: "list" });
    expect(result).toContain("No releases found");
  });

  it("list passes -A flag for all_namespaces", async () => {
    mockStdout("[]");

    await handleK8sHelm({ action: "list", all_namespaces: true });
    expect(mockExecFile).toHaveBeenCalledWith(
      "helm",
      ["list", "-A", "-o", "json"],
      expect.any(Object)
    );
  });

  it("status requires release_name", async () => {
    await expect(handleK8sHelm({ action: "status" })).rejects.toThrow(
      "release_name is required"
    );
  });

  it("status formats release details", async () => {
    const statusData = {
      name: "nginx",
      namespace: "default",
      version: 3,
      info: {
        status: "deployed",
        last_deployed: "2026-03-20T10:00:00Z",
        description: "Upgrade complete",
        notes: "Visit http://nginx.local to access your app.",
      },
    };
    mockStdout(JSON.stringify(statusData));

    const result = await handleK8sHelm({
      action: "status",
      release_name: "nginx",
    });
    expect(result).toContain("nginx");
    expect(result).toContain("deployed");
    expect(result).toContain("Upgrade complete");
    expect(result).toContain("Notes");
    expect(result).toContain("nginx.local");
  });

  it("history requires release_name", async () => {
    await expect(handleK8sHelm({ action: "history" })).rejects.toThrow(
      "release_name is required"
    );
  });

  it("history formats revision table", async () => {
    const entries = [
      {
        revision: 1,
        updated: "2026-03-18",
        status: "superseded",
        chart: "nginx-14.0.0",
        app_version: "1.24.0",
        description: "Install complete",
      },
      {
        revision: 2,
        updated: "2026-03-20",
        status: "deployed",
        chart: "nginx-15.0.0",
        app_version: "1.25.0",
        description: "Upgrade complete",
      },
    ];
    mockStdout(JSON.stringify(entries));

    const result = await handleK8sHelm({
      action: "history",
      release_name: "nginx",
    });
    expect(result).toContain("REVISION");
    expect(result).toContain("1");
    expect(result).toContain("2");
    expect(result).toContain("superseded");
    expect(result).toContain("deployed");
  });

  it("values requires release_name", async () => {
    await expect(handleK8sHelm({ action: "values" })).rejects.toThrow(
      "release_name is required"
    );
  });

  it("values returns raw JSON output", async () => {
    const values = { replicaCount: 3, image: { tag: "v1.2.0" } };
    mockStdout(JSON.stringify(values));

    const result = await handleK8sHelm({
      action: "values",
      release_name: "nginx",
    });
    expect(result).toContain("replicaCount");
    expect(result).toContain("3");
  });

  it("values passes --revision flag", async () => {
    mockStdout("{}");

    await handleK8sHelm({
      action: "values",
      release_name: "nginx",
      revision: 2,
    });
    expect(mockExecFile).toHaveBeenCalledWith(
      "helm",
      expect.arrayContaining(["--revision", "2"]),
      expect.any(Object)
    );
  });

  it("diff requires release_name", async () => {
    await expect(handleK8sHelm({ action: "diff" })).rejects.toThrow(
      "release_name is required"
    );
  });

  it("diff requires revision", async () => {
    await expect(
      handleK8sHelm({ action: "diff", release_name: "nginx" })
    ).rejects.toThrow("revision is required");
  });

  it("diff computes value differences", async () => {
    const currentValues = { replicaCount: 5, image: { tag: "v1.3.0" } };
    const targetValues = { replicaCount: 3, image: { tag: "v1.2.0" } };
    const history = [
      { revision: 1, status: "superseded", chart: "nginx-14.0.0", app_version: "1.24.0", description: "" },
      { revision: 2, status: "deployed", chart: "nginx-15.0.0", app_version: "1.25.0", description: "" },
    ];

    mockStdoutSequence([
      JSON.stringify(currentValues),
      JSON.stringify(targetValues),
      JSON.stringify(history),
    ]);

    const result = await handleK8sHelm({
      action: "diff",
      release_name: "nginx",
      revision: 1,
    });
    expect(result).toContain("Values diff");
    expect(result).toContain("replicaCount");
    expect(result).toContain("image.tag");
  });

  it("rollback requires release_name and revision", async () => {
    await expect(handleK8sHelm({ action: "rollback" })).rejects.toThrow(
      "release_name is required"
    );
    await expect(
      handleK8sHelm({ action: "rollback", release_name: "nginx" })
    ).rejects.toThrow("revision is required");
  });

  it("rollback executes helm rollback", async () => {
    mockStdout("Rollback was a success!");

    const result = await handleK8sHelm({
      action: "rollback",
      release_name: "nginx",
      revision: 1,
      namespace: "default",
    });
    expect(result).toContain("Rollback");
    expect(mockExecFile).toHaveBeenCalledWith(
      "helm",
      ["rollback", "nginx", "1", "-n", "default"],
      expect.any(Object)
    );
  });

  it("uninstall requires release_name", async () => {
    await expect(handleK8sHelm({ action: "uninstall" })).rejects.toThrow(
      "release_name is required"
    );
  });

  it("uninstall executes helm uninstall", async () => {
    mockStdout('release "nginx" uninstalled');

    const result = await handleK8sHelm({
      action: "uninstall",
      release_name: "nginx",
    });
    expect(result).toContain("nginx");
    expect(result).toContain("uninstalled");
  });
});
