import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sJobSchema } from "./job.js";

const mockListNamespacedJob = vi.fn();
const mockListJobForAllNamespaces = vi.fn();
const mockReadNamespacedJob = vi.fn();
const mockCreateNamespacedJob = vi.fn();
const mockDeleteNamespacedJob = vi.fn();
const mockListNamespacedPod = vi.fn();
const mockReadNamespacedPodLog = vi.fn();
const mockListNamespacedEvent = vi.fn();

vi.mock("../../../lib/client.js", () => ({
  createK8sClients: () => ({
    batchApi: {
      listNamespacedJob: mockListNamespacedJob,
      listJobForAllNamespaces: mockListJobForAllNamespaces,
      readNamespacedJob: mockReadNamespacedJob,
      createNamespacedJob: mockCreateNamespacedJob,
      deleteNamespacedJob: mockDeleteNamespacedJob,
    },
    coreApi: {
      listNamespacedPod: mockListNamespacedPod,
      readNamespacedPodLog: mockReadNamespacedPodLog,
      listNamespacedEvent: mockListNamespacedEvent,
    },
  }),
}));

const { handleK8sJob } = await import("./job.js");

describe("K8sJobSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sJobSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list", "describe", "status", "logs", "delete", "create"];
    for (const action of actions) {
      const result = K8sJobSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list returns formatted table", async () => {
    mockListNamespacedJob.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "backup-job", namespace: "default", creationTimestamp: new Date() },
            status: { succeeded: 1, failed: 0, active: 0, completionTime: new Date(), startTime: new Date() },
            spec: { completions: 1 },
          },
        ],
      },
    });

    const result = await handleK8sJob({ action: "list", namespace: "default" });
    expect(result).toContain("backup-job");
    expect(result).toContain("1/1");
  });

  it("list all namespaces", async () => {
    mockListJobForAllNamespaces.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "migrate", namespace: "staging", creationTimestamp: new Date() },
            status: { succeeded: 1, failed: 0, active: 0, completionTime: new Date(), startTime: new Date() },
            spec: { completions: 1 },
          },
        ],
      },
    });

    const result = await handleK8sJob({ action: "list", all_namespaces: true });
    expect(result).toContain("migrate");
    expect(result).toContain("staging");
  });

  it("describe shows detailed info", async () => {
    mockReadNamespacedJob.mockResolvedValue({
      body: {
        metadata: { name: "backup-job", namespace: "default", labels: {}, creationTimestamp: new Date() },
        spec: {
          completions: 1,
          parallelism: 1,
          backoffLimit: 6,
          template: { spec: { containers: [{ name: "backup", image: "backup:v1" }], restartPolicy: "Never" } },
        },
        status: {
          succeeded: 1, failed: 0, active: 0,
          startTime: new Date(),
          completionTime: new Date(),
          conditions: [{ type: "Complete", status: "True" }],
        },
      },
    });
    mockListNamespacedPod.mockResolvedValue({
      body: { items: [{ metadata: { name: "backup-job-abc" }, status: { phase: "Succeeded" } }] },
    });
    mockListNamespacedEvent.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sJob({ action: "describe", job_name: "backup-job" });
    expect(result).toContain("backup-job");
    expect(result).toContain("backup:v1");
    expect(result).toContain("Complete");
  });

  it("describe requires job_name", async () => {
    await expect(
      handleK8sJob({ action: "describe" })
    ).rejects.toThrow("job_name is required");
  });

  it("status shows active/succeeded/failed", async () => {
    mockReadNamespacedJob.mockResolvedValue({
      body: {
        metadata: { name: "backup-job", namespace: "default" },
        spec: { completions: 3 },
        status: { succeeded: 2, failed: 0, active: 1 },
      },
    });

    const result = await handleK8sJob({ action: "status", job_name: "backup-job" });
    expect(result).toContain("2/3");
  });

  it("logs reads pod logs", async () => {
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [{ metadata: { name: "backup-job-abc", namespace: "default" } }],
      },
    });
    mockReadNamespacedPodLog.mockResolvedValue({
      body: "backup started\nbackup complete\n",
    });

    const result = await handleK8sJob({ action: "logs", job_name: "backup-job" });
    expect(result).toContain("backup started");
    expect(result).toContain("backup complete");
  });

  it("logs requires job_name", async () => {
    await expect(
      handleK8sJob({ action: "logs" })
    ).rejects.toThrow("job_name is required");
  });

  it("create builds job from image and command", async () => {
    mockCreateNamespacedJob.mockResolvedValue({
      body: { metadata: { name: "my-job", namespace: "default" } },
    });

    const result = await handleK8sJob({
      action: "create",
      job_name: "my-job",
      image: "busybox:latest",
      command: ["echo", "hello"],
    });
    expect(result).toContain("my-job");
    expect(result).toContain("created");
  });

  it("create requires job_name", async () => {
    await expect(
      handleK8sJob({ action: "create" })
    ).rejects.toThrow("job_name is required");
  });

  it("create requires image", async () => {
    await expect(
      handleK8sJob({ action: "create", job_name: "my-job" })
    ).rejects.toThrow("image is required");
  });

  it("delete removes job", async () => {
    mockDeleteNamespacedJob.mockResolvedValue({});

    const result = await handleK8sJob({
      action: "delete",
      job_name: "backup-job",
    });
    expect(result).toContain("deleted");
  });

  it("delete requires job_name", async () => {
    await expect(
      handleK8sJob({ action: "delete" })
    ).rejects.toThrow("job_name is required");
  });
});
