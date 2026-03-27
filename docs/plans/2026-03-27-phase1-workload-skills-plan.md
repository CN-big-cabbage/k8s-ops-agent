# Phase 1: Workload Skills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 5 new skills (StatefulSet, DaemonSet, Job, CronJob, HPA) to achieve ~95% K8s workload coverage.

**Architecture:** Each skill follows the existing single-tool-with-actions pattern (Zod schema + handler + register function). Shared K8sClients extended with BatchV1Api and AutoscalingV2Api.

**Tech Stack:** TypeScript, @kubernetes/client-node, Zod, Vitest, OpenClaw plugin SDK

---

## Task 1: Extend K8sClients with BatchV1Api and AutoscalingV2Api

**Files:**
- Modify: `lib/client.ts`

**Step 1: Add new API clients to K8sClients interface and factory**

In `lib/client.ts`, add `batchApi` and `autoscalingApi` to the interface and `createK8sClients`:

```typescript
import * as k8s from "@kubernetes/client-node";
import type { PluginConfig } from "./types.js";

export interface K8sClients {
  kc: k8s.KubeConfig;
  coreApi: k8s.CoreV1Api;
  appsApi: k8s.AppsV1Api;
  networkingApi: k8s.NetworkingV1Api;
  storageApi: k8s.StorageV1Api;
  batchApi: k8s.BatchV1Api;
  autoscalingApi: k8s.AutoscalingV2Api;
}
```

And in the `createK8sClients` function, add to the `clients` object:

```typescript
batchApi: kc.makeApiClient(k8s.BatchV1Api),
autoscalingApi: kc.makeApiClient(k8s.AutoscalingV2Api),
```

**Step 2: Verify existing tests still pass**

Run: `npx vitest run`
Expected: All existing tests pass (new fields are additive, mocks don't break).

**Step 3: Commit**

```bash
git add lib/client.ts
git commit -m "feat: add BatchV1Api and AutoscalingV2Api to K8sClients"
```

---

## Task 2: k8s-statefulset skill

**Files:**
- Create: `skills/k8s-statefulset/SKILL.md`
- Create: `skills/k8s-statefulset/src/statefulset.ts`
- Create: `skills/k8s-statefulset/src/statefulset.test.ts`

**Step 1: Create directory structure**

```bash
mkdir -p skills/k8s-statefulset/src
```

**Step 2: Write tests for schema validation and handler**

Create `skills/k8s-statefulset/src/statefulset.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sStatefulSetSchema } from "./statefulset.js";

const mockListNamespacedStatefulSet = vi.fn();
const mockListStatefulSetForAllNamespaces = vi.fn();
const mockReadNamespacedStatefulSet = vi.fn();
const mockReplaceNamespacedStatefulSet = vi.fn();
const mockListNamespacedPersistentVolumeClaim = vi.fn();
const mockListNamespacedEvent = vi.fn();
const mockListNamespacedControllerRevision = vi.fn();

vi.mock("../../../lib/client.js", () => ({
  createK8sClients: () => ({
    appsApi: {
      listNamespacedStatefulSet: mockListNamespacedStatefulSet,
      listStatefulSetForAllNamespaces: mockListStatefulSetForAllNamespaces,
      readNamespacedStatefulSet: mockReadNamespacedStatefulSet,
      replaceNamespacedStatefulSet: mockReplaceNamespacedStatefulSet,
      listNamespacedControllerRevision: mockListNamespacedControllerRevision,
    },
    coreApi: {
      listNamespacedPersistentVolumeClaim: mockListNamespacedPersistentVolumeClaim,
      listNamespacedEvent: mockListNamespacedEvent,
    },
  }),
}));

const { handleK8sStatefulSet } = await import("./statefulset.js");

describe("K8sStatefulSetSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sStatefulSetSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list", "describe", "status", "scale", "rollout_restart", "rollout_undo", "update_image"];
    for (const action of actions) {
      const result = K8sStatefulSetSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sStatefulSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list returns formatted table", async () => {
    mockListNamespacedStatefulSet.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "mysql", namespace: "default", creationTimestamp: new Date() },
            spec: { replicas: 3 },
            status: { readyReplicas: 3, currentReplicas: 3, updatedReplicas: 3 },
          },
        ],
      },
    });

    const result = await handleK8sStatefulSet({ action: "list", namespace: "default" });
    expect(result).toContain("mysql");
    expect(result).toContain("3/3");
  });

  it("scale updates replicas", async () => {
    mockReadNamespacedStatefulSet.mockResolvedValue({
      body: {
        metadata: { name: "mysql", namespace: "default" },
        spec: { replicas: 3 },
      },
    });
    mockReplaceNamespacedStatefulSet.mockResolvedValue({});

    const result = await handleK8sStatefulSet({
      action: "scale",
      statefulset_name: "mysql",
      namespace: "default",
      replicas: 5,
    });
    expect(result).toContain("scaled to 5");
  });

  it("scale requires statefulset_name", async () => {
    await expect(
      handleK8sStatefulSet({ action: "scale", replicas: 3 })
    ).rejects.toThrow("statefulset_name is required");
  });

  it("scale requires replicas", async () => {
    await expect(
      handleK8sStatefulSet({ action: "scale", statefulset_name: "mysql" })
    ).rejects.toThrow("replicas is required");
  });

  it("rollout_restart adds restart annotation", async () => {
    mockReadNamespacedStatefulSet.mockResolvedValue({
      body: {
        metadata: { name: "mysql", namespace: "default" },
        spec: { template: { metadata: { annotations: {} }, spec: { containers: [] } } },
      },
    });
    mockReplaceNamespacedStatefulSet.mockResolvedValue({});

    const result = await handleK8sStatefulSet({
      action: "rollout_restart",
      statefulset_name: "mysql",
    });
    expect(result).toContain("restarted");
  });

  it("update_image requires all params", async () => {
    await expect(
      handleK8sStatefulSet({ action: "update_image", statefulset_name: "mysql" })
    ).rejects.toThrow("container is required");
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run skills/k8s-statefulset`
Expected: FAIL — module not found.

**Step 4: Implement statefulset.ts**

Create `skills/k8s-statefulset/src/statefulset.ts` with:

- `K8sStatefulSetSchema` — Zod schema with actions: list, describe, status, scale, rollout_restart, rollout_undo, update_image
- Params: statefulset_name, namespace, all_namespaces, label_selector, replicas, to_revision, container, image, context
- `formatStatefulSetList()` — table with NAMESPACE, NAME, READY, AGE columns
- `formatStatefulSetDescribe()` — detailed output including PVCs and events
- `formatStatefulSetStatus()` — quick status with ready/current/updated replicas
- `handleK8sStatefulSet()` — exported handler with switch on action
- `registerK8sStatefulSetTools()` — registers `k8s_statefulset` tool

Key implementation details:
- `list` uses `appsApi.listNamespacedStatefulSet` / `listStatefulSetForAllNamespaces`
- `describe` reads StatefulSet, then queries PVCs with label selector matching StatefulSet name
- `scale` reads then replaces with updated `spec.replicas`
- `rollout_restart` adds `kubectl.kubernetes.io/restartedAt` annotation (same as deploy)
- `rollout_undo` uses ControllerRevision to find target revision and restore template
- `update_image` finds container by name and updates image

**Step 5: Run tests to verify they pass**

Run: `npx vitest run skills/k8s-statefulset`
Expected: All PASS.

**Step 6: Create SKILL.md**

Create `skills/k8s-statefulset/SKILL.md` documenting all 7 actions with JSON examples.

**Step 7: Commit**

```bash
git add skills/k8s-statefulset/
git commit -m "feat: add k8s-statefulset skill with 7 actions"
```

---

## Task 3: k8s-daemonset skill

**Files:**
- Create: `skills/k8s-daemonset/SKILL.md`
- Create: `skills/k8s-daemonset/src/daemonset.ts`
- Create: `skills/k8s-daemonset/src/daemonset.test.ts`

**Step 1: Create directory structure**

```bash
mkdir -p skills/k8s-daemonset/src
```

**Step 2: Write tests**

Create `skills/k8s-daemonset/src/daemonset.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sDaemonSetSchema } from "./daemonset.js";

const mockListNamespacedDaemonSet = vi.fn();
const mockListDaemonSetForAllNamespaces = vi.fn();
const mockReadNamespacedDaemonSet = vi.fn();
const mockReplaceNamespacedDaemonSet = vi.fn();
const mockListNamespacedEvent = vi.fn();

vi.mock("../../../lib/client.js", () => ({
  createK8sClients: () => ({
    appsApi: {
      listNamespacedDaemonSet: mockListNamespacedDaemonSet,
      listDaemonSetForAllNamespaces: mockListDaemonSetForAllNamespaces,
      readNamespacedDaemonSet: mockReadNamespacedDaemonSet,
      replaceNamespacedDaemonSet: mockReplaceNamespacedDaemonSet,
    },
    coreApi: {
      listNamespacedEvent: mockListNamespacedEvent,
    },
  }),
}));

const { handleK8sDaemonSet } = await import("./daemonset.js");

describe("K8sDaemonSetSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sDaemonSetSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid actions", () => {
    const actions = ["list", "describe", "status", "rollout_restart", "update_image"];
    for (const action of actions) {
      const result = K8sDaemonSetSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sDaemonSet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list returns formatted table", async () => {
    mockListNamespacedDaemonSet.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "fluentd", namespace: "kube-system", creationTimestamp: new Date() },
            status: {
              desiredNumberScheduled: 3,
              currentNumberScheduled: 3,
              numberReady: 3,
              numberMisscheduled: 0,
              updatedNumberScheduled: 3,
              numberAvailable: 3,
            },
          },
        ],
      },
    });

    const result = await handleK8sDaemonSet({ action: "list", namespace: "kube-system" });
    expect(result).toContain("fluentd");
    expect(result).toContain("3");
  });

  it("status shows node coverage", async () => {
    mockReadNamespacedDaemonSet.mockResolvedValue({
      body: {
        metadata: { name: "fluentd", namespace: "kube-system" },
        status: {
          desiredNumberScheduled: 5,
          currentNumberScheduled: 5,
          numberReady: 4,
          numberMisscheduled: 0,
          updatedNumberScheduled: 5,
          numberAvailable: 4,
        },
      },
    });

    const result = await handleK8sDaemonSet({
      action: "status",
      daemonset_name: "fluentd",
      namespace: "kube-system",
    });
    expect(result).toContain("4/5");
  });

  it("rollout_restart requires daemonset_name", async () => {
    await expect(
      handleK8sDaemonSet({ action: "rollout_restart" })
    ).rejects.toThrow("daemonset_name is required");
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run skills/k8s-daemonset`
Expected: FAIL.

**Step 4: Implement daemonset.ts**

Create `skills/k8s-daemonset/src/daemonset.ts` with:

- `K8sDaemonSetSchema` — actions: list, describe, status, rollout_restart, update_image
- Params: daemonset_name, namespace, all_namespaces, label_selector, container, image, context
- `formatDaemonSetList()` — table with NAMESPACE, NAME, DESIRED, CURRENT, READY, UP-TO-DATE, AVAILABLE, AGE
- `formatDaemonSetDescribe()` — detailed output with node selector, tolerations, events
- `formatDaemonSetStatus()` — shows node coverage ratio and misscheduled count
- `handleK8sDaemonSet()` — exported handler
- `registerK8sDaemonSetTools()` — registers `k8s_daemonset` tool

Key: DaemonSet has no `scale` — replicas are driven by node count.

**Step 5: Run tests and verify pass**

Run: `npx vitest run skills/k8s-daemonset`
Expected: All PASS.

**Step 6: Create SKILL.md**

**Step 7: Commit**

```bash
git add skills/k8s-daemonset/
git commit -m "feat: add k8s-daemonset skill with 5 actions"
```

---

## Task 4: k8s-job skill

**Files:**
- Create: `skills/k8s-job/SKILL.md`
- Create: `skills/k8s-job/src/job.ts`
- Create: `skills/k8s-job/src/job.test.ts`

**Step 1: Create directory structure**

```bash
mkdir -p skills/k8s-job/src
```

**Step 2: Write tests**

Create `skills/k8s-job/src/job.test.ts`:

```typescript
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
            status: { succeeded: 1, failed: 0, active: 0, completionTime: new Date() },
            spec: { completions: 1 },
          },
        ],
      },
    });

    const result = await handleK8sJob({ action: "list", namespace: "default" });
    expect(result).toContain("backup-job");
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

  it("create requires job_name and image", async () => {
    await expect(
      handleK8sJob({ action: "create" })
    ).rejects.toThrow("job_name is required");
  });

  it("delete requires job_name", async () => {
    await expect(
      handleK8sJob({ action: "delete" })
    ).rejects.toThrow("job_name is required");
  });
});
```

**Step 3: Run tests to verify fail, then implement**

**Step 4: Implement job.ts**

Create `skills/k8s-job/src/job.ts` with:

- `K8sJobSchema` — actions: list, describe, status, logs, delete, create
- Params: job_name, namespace, all_namespaces, label_selector, image, command(array), tail_lines, context
- `formatJobList()` — table with NAMESPACE, NAME, COMPLETIONS, DURATION, AGE
- `formatJobDescribe()` — detailed output with conditions, Pod statuses, events
- `formatJobStatus()` — active/succeeded/failed counts
- `handleK8sJob()` — exported handler
- `registerK8sJobTools()` — registers `k8s_job` tool

Key implementation:
- `logs` finds pods via `job-name=<name>` label selector, reads log from first pod
- `create` builds a `V1Job` object: `{ metadata, spec: { template: { spec: { containers: [{ name, image, command }], restartPolicy: "Never" } } } }`
- `delete` uses `propagationPolicy: "Background"` to clean up pods

**Step 5: Run tests, create SKILL.md, commit**

```bash
git add skills/k8s-job/
git commit -m "feat: add k8s-job skill with 6 actions"
```

---

## Task 5: k8s-cronjob skill

**Files:**
- Create: `skills/k8s-cronjob/SKILL.md`
- Create: `skills/k8s-cronjob/src/cronjob.ts`
- Create: `skills/k8s-cronjob/src/cronjob.test.ts`

**Step 1: Create directory structure**

```bash
mkdir -p skills/k8s-cronjob/src
```

**Step 2: Write tests**

Create `skills/k8s-cronjob/src/cronjob.test.ts`:

```typescript
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
            status: { lastScheduleTime: new Date() },
          },
        ],
      },
    });

    const result = await handleK8sCronJob({ action: "list", namespace: "default" });
    expect(result).toContain("nightly-backup");
    expect(result).toContain("0 2 * * *");
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
});
```

**Step 3: Run tests to verify fail, then implement**

**Step 4: Implement cronjob.ts**

Create `skills/k8s-cronjob/src/cronjob.ts` with:

- `K8sCronJobSchema` — actions: list, describe, status, suspend, trigger, history
- Params: cronjob_name, namespace, all_namespaces, label_selector, suspend(bool), limit, context
- `formatCronJobList()` — table with NAMESPACE, NAME, SCHEDULE, SUSPEND, ACTIVE, LAST-SCHEDULE, AGE
- `formatCronJobDescribe()` — detailed output with jobTemplate, concurrencyPolicy, history limits
- `handleK8sCronJob()` — exported handler
- `registerK8sCronJobTools()` — registers `k8s_cronjob` tool

Key implementation:
- `trigger` reads CronJob's jobTemplate, creates a Job with name `<cronjob>-manual-<timestamp>` and annotation `cronjob.kubernetes.io/instantiate: "manual"`
- `suspend` patches CronJob's `spec.suspend` field
- `history` lists Jobs with label `job-name` matching the CronJob's owned jobs (via ownerReferences)

**Step 5: Run tests, create SKILL.md, commit**

```bash
git add skills/k8s-cronjob/
git commit -m "feat: add k8s-cronjob skill with 6 actions"
```

---

## Task 6: k8s-hpa skill

**Files:**
- Create: `skills/k8s-hpa/SKILL.md`
- Create: `skills/k8s-hpa/src/hpa.ts`
- Create: `skills/k8s-hpa/src/hpa.test.ts`

**Step 1: Create directory structure**

```bash
mkdir -p skills/k8s-hpa/src
```

**Step 2: Write tests**

Create `skills/k8s-hpa/src/hpa.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { K8sHpaSchema } from "./hpa.js";

const mockListNamespacedHorizontalPodAutoscaler = vi.fn();
const mockListHorizontalPodAutoscalerForAllNamespaces = vi.fn();
const mockReadNamespacedHorizontalPodAutoscaler = vi.fn();
const mockCreateNamespacedHorizontalPodAutoscaler = vi.fn();
const mockPatchNamespacedHorizontalPodAutoscaler = vi.fn();
const mockDeleteNamespacedHorizontalPodAutoscaler = vi.fn();

vi.mock("../../../lib/client.js", () => ({
  createK8sClients: () => ({
    autoscalingApi: {
      listNamespacedHorizontalPodAutoscaler: mockListNamespacedHorizontalPodAutoscaler,
      listHorizontalPodAutoscalerForAllNamespaces: mockListHorizontalPodAutoscalerForAllNamespaces,
      readNamespacedHorizontalPodAutoscaler: mockReadNamespacedHorizontalPodAutoscaler,
      createNamespacedHorizontalPodAutoscaler: mockCreateNamespacedHorizontalPodAutoscaler,
      patchNamespacedHorizontalPodAutoscaler: mockPatchNamespacedHorizontalPodAutoscaler,
      deleteNamespacedHorizontalPodAutoscaler: mockDeleteNamespacedHorizontalPodAutoscaler,
    },
  }),
}));

const { handleK8sHpa } = await import("./hpa.js");

describe("K8sHpaSchema validation", () => {
  it("accepts all valid actions", () => {
    const actions = ["list", "describe", "status", "create", "update", "delete"];
    for (const action of actions) {
      const result = K8sHpaSchema.safeParse({ action });
      expect(result.success).toBe(true);
    }
  });
});

describe("handleK8sHpa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list returns formatted table", async () => {
    mockListNamespacedHorizontalPodAutoscaler.mockResolvedValue({
      body: {
        items: [
          {
            metadata: { name: "web-hpa", namespace: "default", creationTimestamp: new Date() },
            spec: {
              scaleTargetRef: { kind: "Deployment", name: "web", apiVersion: "apps/v1" },
              minReplicas: 2,
              maxReplicas: 10,
            },
            status: { currentReplicas: 3, desiredReplicas: 3 },
          },
        ],
      },
    });

    const result = await handleK8sHpa({ action: "list", namespace: "default" });
    expect(result).toContain("web-hpa");
    expect(result).toContain("2");
    expect(result).toContain("10");
  });

  it("create builds HPA with cpu target", async () => {
    mockCreateNamespacedHorizontalPodAutoscaler.mockResolvedValue({
      body: { metadata: { name: "web-hpa", namespace: "default" } },
    });

    const result = await handleK8sHpa({
      action: "create",
      hpa_name: "web-hpa",
      target_ref: "Deployment/web",
      min_replicas: 2,
      max_replicas: 10,
      cpu_target: 80,
    });
    expect(result).toContain("web-hpa");
    expect(result).toContain("created");
  });

  it("create requires hpa_name and target_ref", async () => {
    await expect(
      handleK8sHpa({ action: "create" })
    ).rejects.toThrow("hpa_name is required");
  });

  it("delete requires hpa_name", async () => {
    await expect(
      handleK8sHpa({ action: "delete" })
    ).rejects.toThrow("hpa_name is required");
  });

  it("update patches min/max replicas", async () => {
    mockReadNamespacedHorizontalPodAutoscaler.mockResolvedValue({
      body: {
        metadata: { name: "web-hpa", namespace: "default" },
        spec: {
          scaleTargetRef: { kind: "Deployment", name: "web", apiVersion: "apps/v1" },
          minReplicas: 2,
          maxReplicas: 10,
        },
      },
    });
    mockPatchNamespacedHorizontalPodAutoscaler.mockResolvedValue({});

    const result = await handleK8sHpa({
      action: "update",
      hpa_name: "web-hpa",
      min_replicas: 3,
      max_replicas: 15,
    });
    expect(result).toContain("updated");
  });
});
```

**Step 3: Run tests to verify fail, then implement**

**Step 4: Implement hpa.ts**

Create `skills/k8s-hpa/src/hpa.ts` with:

- `K8sHpaSchema` — actions: list, describe, status, create, update, delete
- Params: hpa_name, namespace, all_namespaces, label_selector, target_ref(string "Kind/name"), min_replicas, max_replicas, cpu_target, context
- `formatHpaList()` — table with NAMESPACE, NAME, REFERENCE, TARGETS, MINPODS, MAXPODS, REPLICAS, AGE
- `formatHpaDescribe()` — detailed output with metrics, conditions, events
- `formatHpaStatus()` — current vs target metrics, replica range
- `handleK8sHpa()` — exported handler
- `registerK8sHpaTools()` — registers `k8s_hpa` tool

Key implementation:
- `create` parses `target_ref` as "Kind/name" (e.g. "Deployment/web"), builds `V2HorizontalPodAutoscaler` with CPU metric at `cpu_target` percent
- `describe` shows current metric values from `status.currentMetrics` vs targets in `spec.metrics`
- `update` patches `spec.minReplicas`, `spec.maxReplicas`, and optionally cpu metric target

**Step 5: Run tests, create SKILL.md, commit**

```bash
git add skills/k8s-hpa/
git commit -m "feat: add k8s-hpa skill with 6 actions"
```

---

## Task 7: Register all skills and bump version

**Files:**
- Modify: `index.ts`
- Modify: `package.json`

**Step 1: Update index.ts**

Add imports:
```typescript
import { registerK8sStatefulSetTools } from "./skills/k8s-statefulset/src/statefulset.js";
import { registerK8sDaemonSetTools } from "./skills/k8s-daemonset/src/daemonset.js";
import { registerK8sJobTools } from "./skills/k8s-job/src/job.js";
import { registerK8sCronJobTools } from "./skills/k8s-cronjob/src/cronjob.js";
import { registerK8sHpaTools } from "./skills/k8s-hpa/src/hpa.js";
```

Add registrations inside `load()`:
```typescript
// Phase 1: Workload skills
registerK8sStatefulSetTools(api);
registerK8sDaemonSetTools(api);
registerK8sJobTools(api);
registerK8sCronJobTools(api);
registerK8sHpaTools(api);
```

Update description to `"19 tools"` and log message.

**Step 2: Bump package.json version**

Change `"version": "1.3.0"` to `"version": "1.4.0"`.

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add index.ts package.json
git commit -m "feat: register 5 new workload skills, bump to v1.4.0"
```

---

## Summary

| Task | Skill | Actions | Est. Lines |
|------|-------|---------|------------|
| 1 | lib/client.ts extension | — | ~10 |
| 2 | k8s-statefulset | 7 | ~450 |
| 3 | k8s-daemonset | 5 | ~320 |
| 4 | k8s-job | 6 | ~380 |
| 5 | k8s-cronjob | 6 | ~400 |
| 6 | k8s-hpa | 6 | ~380 |
| 7 | Registration + version | — | ~15 |
| **Total** | **5 skills** | **30 actions** | **~1,955** |
