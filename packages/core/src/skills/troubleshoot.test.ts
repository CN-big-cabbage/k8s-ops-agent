import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sTroubleshootSchema } from "./troubleshoot.js";

const mockReadNamespacedPod = vi.fn();
const mockListNamespacedPod = vi.fn();
const mockListNamespacedEvent = vi.fn();
const mockReadNamespacedService = vi.fn();
const mockReadNode = vi.fn();
const mockReadNamespacedPersistentVolumeClaim = vi.fn();
const mockReadStorageClass = vi.fn();
const mockReadNamespacedDeployment = vi.fn();
const mockListNamespacedReplicaSet = vi.fn();

vi.mock("../lib/client.js", () => ({
  createK8sClients: () => ({
    coreApi: {
      readNamespacedPod: mockReadNamespacedPod,
      listNamespacedPod: mockListNamespacedPod,
      listNamespacedEvent: mockListNamespacedEvent,
      readNamespacedService: mockReadNamespacedService,
      readNode: mockReadNode,
      readNamespacedPersistentVolumeClaim: mockReadNamespacedPersistentVolumeClaim,
    },
    appsApi: {
      readNamespacedDeployment: mockReadNamespacedDeployment,
      listNamespacedReplicaSet: mockListNamespacedReplicaSet,
    },
    storageApi: {
      readStorageClass: mockReadStorageClass,
    },
  }),
}));

const { handleK8sTroubleshoot } = await import("./troubleshoot.js");

function mockEventsEmpty() {
  mockListNamespacedEvent.mockResolvedValue({ body: { items: [] } });
}

describe("K8sTroubleshootSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sTroubleshootSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = [
      "pod_not_ready", "service_no_endpoints", "node_not_ready",
      "pvc_pending", "deployment_stuck", "diagnose",
    ];
    for (const action of actions) {
      const result = K8sTroubleshootSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sTroubleshoot pod_not_ready", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventsEmpty();
  });

  it("requires name", async () => {
    await expect(
      handleK8sTroubleshoot({ action: "pod_not_ready" })
    ).rejects.toThrow("name is required");
  });

  it("detects CrashLoopBackOff with OOMKilled", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "web",
              ready: false,
              restartCount: 15,
              state: { waiting: { reason: "CrashLoopBackOff" } },
              lastState: { terminated: { exitCode: 137, reason: "OOMKilled" } },
            },
          ],
        },
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "pod_not_ready",
      name: "web-abc",
    });
    expect(result).toContain("CrashLoopBackOff");
    expect(result).toContain("OOMKilled");
    expect(result).toContain("exit code 137");
    expect(result).toContain("Increase memory limits");
  });

  it("detects ImagePullBackOff", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        status: {
          phase: "Pending",
          containerStatuses: [
            {
              name: "app",
              ready: false,
              restartCount: 0,
              state: {
                waiting: {
                  reason: "ImagePullBackOff",
                  message: "Back-off pulling image \"nonexistent:latest\"",
                },
              },
            },
          ],
        },
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "pod_not_ready",
      name: "app-xyz",
    });
    expect(result).toContain("ImagePullBackOff");
    expect(result).toContain("image name and tag");
    expect(result).toContain("registry credentials");
  });

  it("detects scheduling failure via events", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        status: {
          phase: "Pending",
          containerStatuses: [],
        },
      },
    });
    mockListNamespacedEvent.mockResolvedValue({
      body: {
        items: [
          {
            type: "Warning",
            reason: "FailedScheduling",
            message: "0/3 nodes are available: 3 Insufficient cpu",
            lastTimestamp: new Date(),
          },
        ],
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "pod_not_ready",
      name: "cpu-hog",
    });
    expect(result).toContain("FailedScheduling");
    expect(result).toContain("Insufficient cpu");
    expect(result).toContain("Reduce CPU requests");
  });

  it("detects pod not found", async () => {
    mockReadNamespacedPod.mockRejectedValue(new Error("not found"));

    const result = await handleK8sTroubleshoot({
      action: "pod_not_ready",
      name: "nonexistent",
    });
    expect(result).toContain("NOT FOUND");
    expect(result).toContain("does not exist");
  });

  it("detects running but not ready (readiness probe)", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "web",
              ready: false,
              restartCount: 0,
              state: { running: { startedAt: "2026-03-01T00:00:00Z" } },
            },
          ],
        },
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "pod_not_ready",
      name: "web-pod",
    });
    expect(result).toContain("Running but NOT Ready");
    expect(result).toContain("readiness probe");
  });
});

describe("handleK8sTroubleshoot service_no_endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventsEmpty();
  });

  it("detects selector mismatch (no matching pods)", async () => {
    mockReadNamespacedService.mockResolvedValue({
      body: {
        spec: {
          selector: { app: "web", version: "v2" },
          ports: [{ port: 80, targetPort: 8080 }],
        },
      },
    });
    mockListNamespacedPod
      .mockResolvedValueOnce({ body: { items: [] } })
      .mockResolvedValueOnce({
        body: {
          items: [
            { metadata: { name: "web-v1", labels: { app: "web", version: "v1" } } },
          ],
        },
      });

    const result = await handleK8sTroubleshoot({
      action: "service_no_endpoints",
      name: "web-svc",
    });
    expect(result).toContain("0 pods match");
    expect(result).toContain("No pods in namespace");
    expect(result).toContain("partial label match");
  });

  it("detects no selector defined", async () => {
    mockReadNamespacedService.mockResolvedValue({
      body: {
        spec: { selector: {}, ports: [{ port: 80 }] },
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "service_no_endpoints",
      name: "external-svc",
    });
    expect(result).toContain("no selector");
  });

  it("detects matching pods not ready", async () => {
    mockReadNamespacedService.mockResolvedValue({
      body: {
        spec: {
          selector: { app: "web" },
          ports: [{ port: 80, targetPort: 8080 }],
        },
      },
    });
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-123" },
            status: {
              conditions: [{ type: "Ready", status: "False" }],
            },
          },
        ],
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "service_no_endpoints",
      name: "web-svc",
    });
    expect(result).toContain("1 pod(s) match");
    expect(result).toContain("0 pods are Ready");
    expect(result).toContain("pod_not_ready");
  });

  it("detects service not found", async () => {
    mockReadNamespacedService.mockRejectedValue(new Error("not found"));

    const result = await handleK8sTroubleshoot({
      action: "service_no_endpoints",
      name: "nonexistent",
    });
    expect(result).toContain("NOT FOUND");
  });
});

describe("handleK8sTroubleshoot node_not_ready", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects pressure conditions", async () => {
    mockReadNode.mockResolvedValue({
      body: {
        status: {
          conditions: [
            { type: "Ready", status: "False", reason: "KubeletNotReady", message: "PLEG is not healthy" },
            { type: "MemoryPressure", status: "True", reason: "KubeletHasInsufficientMemory", message: "available < threshold" },
            { type: "DiskPressure", status: "False" },
            { type: "PIDPressure", status: "False" },
          ],
          nodeInfo: {
            kubeletVersion: "v1.28.0",
            osImage: "Ubuntu 22.04",
            containerRuntimeVersion: "containerd://1.7.0",
          },
          allocatable: { cpu: "4", memory: "8Gi" },
        },
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "node_not_ready",
      name: "worker-1",
    });
    expect(result).toContain("NotReady");
    expect(result).toContain("MemoryPressure");
    expect(result).toContain("memory");
    expect(result).toContain("kubelet v1.28.0");
  });

  it("detects node not found", async () => {
    mockReadNode.mockRejectedValue(new Error("not found"));

    const result = await handleK8sTroubleshoot({
      action: "node_not_ready",
      name: "ghost-node",
    });
    expect(result).toContain("NOT FOUND");
    expect(result).toContain("does not exist");
  });
});

describe("handleK8sTroubleshoot pvc_pending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventsEmpty();
  });

  it("detects missing StorageClass", async () => {
    mockReadNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: {
        spec: {
          storageClassName: "premium-ssd",
          accessModes: ["ReadWriteOnce"],
          resources: { requests: { storage: "10Gi" } },
        },
        status: { phase: "Pending" },
      },
    });
    mockReadStorageClass.mockRejectedValue(new Error("not found"));

    const result = await handleK8sTroubleshoot({
      action: "pvc_pending",
      name: "data-vol",
    });
    expect(result).toContain("premium-ssd");
    expect(result).toContain("NOT FOUND");
    expect(result).toContain("StorageClass");
  });

  it("detects provisioning failure from events", async () => {
    mockReadNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: {
        spec: {
          storageClassName: "standard",
          accessModes: ["ReadWriteOnce"],
          resources: { requests: { storage: "5Gi" } },
        },
        status: { phase: "Pending" },
      },
    });
    mockReadStorageClass.mockResolvedValue({
      body: { provisioner: "kubernetes.io/aws-ebs", reclaimPolicy: "Delete" },
    });
    mockListNamespacedEvent.mockResolvedValue({
      body: {
        items: [
          {
            type: "Warning",
            reason: "ProvisioningFailed",
            message: "Failed to provision volume: quota exceeded",
            lastTimestamp: new Date(),
          },
        ],
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "pvc_pending",
      name: "data-vol",
    });
    expect(result).toContain("ProvisioningFailed");
    expect(result).toContain("quota exceeded");
    expect(result).toContain("provisioner pods");
  });

  it("detects PVC already bound", async () => {
    mockReadNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: {
        spec: { storageClassName: "standard" },
        status: { phase: "Bound" },
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "pvc_pending",
      name: "good-vol",
    });
    expect(result).toContain("already Bound");
    expect(result).toContain("no issue");
  });
});

describe("handleK8sTroubleshoot deployment_stuck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventsEmpty();
  });

  it("detects ProgressDeadlineExceeded", async () => {
    mockReadNamespacedDeployment.mockResolvedValue({
      body: {
        spec: { replicas: 3, selector: { matchLabels: { app: "web" } } },
        status: {
          readyReplicas: 1,
          updatedReplicas: 2,
          unavailableReplicas: 2,
          conditions: [
            { type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded", message: "has timed out progressing" },
            { type: "Available", status: "False", reason: "MinimumReplicasUnavailable" },
          ],
        },
      },
    });
    mockListNamespacedReplicaSet.mockResolvedValue({
      body: { items: [] },
    });

    const result = await handleK8sTroubleshoot({
      action: "deployment_stuck",
      name: "web",
    });
    expect(result).toContain("ProgressDeadlineExceeded");
    expect(result).toContain("rollout is stuck");
  });

  it("detects quota exceeded from events", async () => {
    mockReadNamespacedDeployment.mockResolvedValue({
      body: {
        spec: { replicas: 5, selector: { matchLabels: { app: "api" } } },
        status: {
          readyReplicas: 2,
          updatedReplicas: 2,
          unavailableReplicas: 3,
          conditions: [
            { type: "Progressing", status: "True", reason: "NewReplicaSetAvailable" },
            { type: "Available", status: "False", reason: "MinimumReplicasUnavailable" },
          ],
        },
      },
    });
    mockListNamespacedReplicaSet.mockResolvedValue({
      body: { items: [] },
    });
    mockListNamespacedEvent.mockResolvedValue({
      body: {
        items: [
          {
            type: "Warning",
            reason: "FailedCreate",
            message: "Error creating: pods \"api-abc\" is forbidden: exceeded quota",
            lastTimestamp: new Date(),
          },
        ],
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "deployment_stuck",
      name: "api",
    });
    expect(result).toContain("exceeded quota");
    expect(result).toContain("quota increase");
  });

  it("detects new pods failing with CrashLoopBackOff", async () => {
    mockReadNamespacedDeployment.mockResolvedValue({
      body: {
        spec: { replicas: 3, selector: { matchLabels: { app: "web" } } },
        status: {
          readyReplicas: 0,
          updatedReplicas: 3,
          unavailableReplicas: 3,
          conditions: [
            { type: "Progressing", status: "True", reason: "ReplicaSetUpdated" },
            { type: "Available", status: "False", reason: "MinimumReplicasUnavailable" },
          ],
        },
      },
    });
    mockListNamespacedReplicaSet.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-rs-new", annotations: { "deployment.kubernetes.io/revision": "2" } },
            spec: { replicas: 3, selector: { matchLabels: { app: "web", "pod-template-hash": "abc" } } },
            status: { readyReplicas: 0 },
          },
        ],
      },
    });
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-rs-new-pod1" },
            status: {
              containerStatuses: [
                { name: "web", state: { waiting: { reason: "CrashLoopBackOff", message: "back-off" } } },
              ],
            },
          },
        ],
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "deployment_stuck",
      name: "web",
    });
    expect(result).toContain("CrashLoopBackOff");
    expect(result).toContain("pod_not_ready");
  });
});

describe("handleK8sTroubleshoot diagnose", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventsEmpty();
  });

  it("auto-routes pod to pod_not_ready", async () => {
    mockReadNamespacedPod.mockResolvedValue({
      body: {
        status: {
          phase: "Running",
          containerStatuses: [
            {
              name: "app",
              ready: false,
              restartCount: 0,
              state: { running: { startedAt: "2026-03-01T00:00:00Z" } },
            },
          ],
        },
      },
    });

    const result = await handleK8sTroubleshoot({
      action: "diagnose",
      name: "app-pod",
      resource_type: "pod",
    });
    expect(result).toContain("Troubleshoot");
    expect(result).toContain("Running but NOT Ready");
  });

  it("auto-routes deployment to deployment_stuck", async () => {
    mockReadNamespacedDeployment.mockResolvedValue({
      body: {
        spec: { replicas: 1, selector: { matchLabels: { app: "test" } } },
        status: {
          readyReplicas: 1,
          updatedReplicas: 1,
          conditions: [
            { type: "Available", status: "True", reason: "MinimumReplicasAvailable" },
            { type: "Progressing", status: "True", reason: "NewReplicaSetAvailable" },
          ],
        },
      },
    });
    mockListNamespacedReplicaSet.mockResolvedValue({ body: { items: [] } });

    const result = await handleK8sTroubleshoot({
      action: "diagnose",
      name: "test-deploy",
      resource_type: "deploy",
    });
    expect(result).toContain("Troubleshoot");
    expect(result).toContain("healthy");
  });

  it("requires resource_type for diagnose", async () => {
    await expect(
      handleK8sTroubleshoot({ action: "diagnose", name: "foo" })
    ).rejects.toThrow("resource_type is required");
  });

  it("returns error for unsupported resource type", async () => {
    const result = await handleK8sTroubleshoot({
      action: "diagnose",
      name: "foo",
      resource_type: "configmap",
    });
    expect(result).toContain("not supported");
    expect(result).toContain("configmap");
  });
});
