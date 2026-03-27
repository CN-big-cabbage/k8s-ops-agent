import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sCronJobSchema } from "./cronjob.js";

const mockListNamespacedCronJob = vi.fn();
const mockListCronJobForAllNamespaces = vi.fn();
const mockReadNamespacedCronJob = vi.fn();
const mockPatchNamespacedCronJob = vi.fn();
const mockListNamespacedJob = vi.fn();
const mockCreateNamespacedJob = vi.fn();

vi.mock("../../../lib/client.js", () => ({
  createK8sClients: () => ({
    batchApi: {
      listNamespacedCronJob: mockListNamespacedCronJob,
      listCronJobForAllNamespaces: mockListCronJobForAllNamespaces,
      readNamespacedCronJob: mockReadNamespacedCronJob,
      patchNamespacedCronJob: mockPatchNamespacedCronJob,
      listNamespacedJob: mockListNamespacedJob,
      createNamespacedJob: mockCreateNamespacedJob,
    },
  }),
}));

const { handleK8sCronJob } = await import("./cronjob.js");

describe("K8sCronJobSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sCronJobSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list", "describe", "status", "suspend", "trigger", "history"];
    for (const action of actions) {
      const result = K8sCronJobSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sCronJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list returns formatted table", async () => {
    mockListNamespacedCronJob.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "nightly-backup", namespace: "default", creationTimestamp: new Date() },
            spec: { schedule: "0 2 * * *", suspend: false },
            status: { lastScheduleTime: new Date(), active: [] },
          },
        ],
      },
    });

    const result = await handleK8sCronJob({ action: "list", namespace: "default" });
    expect(result).toContain("nightly-backup");
    expect(result).toContain("0 2 * * *");
  });

  it("list all namespaces", async () => {
    mockListCronJobForAllNamespaces.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "cleanup", namespace: "staging", creationTimestamp: new Date() },
            spec: { schedule: "*/30 * * * *", suspend: false },
            status: { lastScheduleTime: new Date(), active: [] },
          },
        ],
      },
    });

    const result = await handleK8sCronJob({ action: "list", all_namespaces: true });
    expect(result).toContain("cleanup");
    expect(result).toContain("staging");
  });

  it("describe shows detailed info", async () => {
    mockReadNamespacedCronJob.mockResolvedValue({
      body: {
        metadata: { name: "nightly-backup", namespace: "default", labels: {}, creationTimestamp: new Date() },
        spec: {
          schedule: "0 2 * * *",
          suspend: false,
          concurrencyPolicy: "Forbid",
          successfulJobsHistoryLimit: 3,
          failedJobsHistoryLimit: 1,
          jobTemplate: {
            spec: { template: { spec: { containers: [{ name: "backup", image: "backup:v1" }], restartPolicy: "Never" } } },
          },
        },
        status: { lastScheduleTime: new Date(), active: [] },
      },
    });

    const result = await handleK8sCronJob({ action: "describe", cronjob_name: "nightly-backup" });
    expect(result).toContain("nightly-backup");
    expect(result).toContain("0 2 * * *");
    expect(result).toContain("Forbid");
  });

  it("describe requires cronjob_name", async () => {
    await expect(
      handleK8sCronJob({ action: "describe" })
    ).rejects.toThrow("cronjob_name is required");
  });

  it("status shows schedule and last run", async () => {
    mockReadNamespacedCronJob.mockResolvedValue({
      body: {
        metadata: { name: "nightly-backup", namespace: "default" },
        spec: { schedule: "0 2 * * *", suspend: false },
        status: { lastScheduleTime: new Date(), active: [] },
      },
    });

    const result = await handleK8sCronJob({ action: "status", cronjob_name: "nightly-backup" });
    expect(result).toContain("0 2 * * *");
    expect(result).toContain("Active");
  });

  it("suspend toggles suspend field", async () => {
    mockReadNamespacedCronJob.mockResolvedValue({
      body: {
        metadata: { name: "nightly-backup", namespace: "default" },
        spec: { schedule: "0 2 * * *", suspend: false },
      },
    });
    mockPatchNamespacedCronJob.mockResolvedValue({});

    const result = await handleK8sCronJob({
      action: "suspend",
      cronjob_name: "nightly-backup",
      suspend: true,
    });
    expect(result).toContain("suspended");
  });

  it("suspend requires cronjob_name", async () => {
    await expect(
      handleK8sCronJob({ action: "suspend" })
    ).rejects.toThrow("cronjob_name is required");
  });

  it("trigger creates manual job", async () => {
    mockReadNamespacedCronJob.mockResolvedValue({
      body: {
        metadata: { name: "nightly-backup", namespace: "default" },
        spec: {
          schedule: "0 2 * * *",
          jobTemplate: {
            spec: { template: { spec: { containers: [{ name: "backup", image: "backup:v1" }], restartPolicy: "Never" } } },
          },
        },
      },
    });
    mockCreateNamespacedJob.mockResolvedValue({
      body: { metadata: { name: "nightly-backup-manual-12345", namespace: "default" } },
    });

    const result = await handleK8sCronJob({
      action: "trigger",
      cronjob_name: "nightly-backup",
    });
    expect(result).toContain("triggered");
    expect(result).toContain("manual");
  });

  it("trigger requires cronjob_name", async () => {
    await expect(
      handleK8sCronJob({ action: "trigger" })
    ).rejects.toThrow("cronjob_name is required");
  });

  it("history shows recent jobs", async () => {
    mockListNamespacedJob.mockResolvedValue({
      body: {
        items: [
          {
            metadata: {
              name: "nightly-backup-28450000",
              namespace: "default",
              creationTimestamp: new Date(),
              ownerReferences: [{ kind: "CronJob", name: "nightly-backup", controller: true, uid: "abc", apiVersion: "batch/v1" }],
            },
            status: { succeeded: 1, failed: 0, startTime: new Date(), completionTime: new Date() },
            spec: { completions: 1 },
          },
        ],
      },
    });

    const result = await handleK8sCronJob({ action: "history", cronjob_name: "nightly-backup" });
    expect(result).toContain("nightly-backup-28450000");
  });

  it("history requires cronjob_name", async () => {
    await expect(
      handleK8sCronJob({ action: "history" })
    ).rejects.toThrow("cronjob_name is required");
  });
});
