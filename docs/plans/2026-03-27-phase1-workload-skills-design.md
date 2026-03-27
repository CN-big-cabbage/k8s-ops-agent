# Phase 1: Workload Skills Design

**Date:** 2026-03-27
**Status:** Approved
**Scope:** 5 new skills covering core K8s workload resources

## Goal

Expand k8s-ops-agent from 14 to 19 skills, achieving ~95% coverage of Kubernetes workload resources by adding StatefulSet, DaemonSet, Job, CronJob, and HPA support.

## Infrastructure Changes

### lib/client.ts

Add two new API clients to `K8sClients`:

```typescript
batchApi: k8s.BatchV1Api;            // Job, CronJob
autoscalingApi: k8s.AutoscalingV2Api; // HPA (v2 for custom metrics)
```

### index.ts

Register 5 new skills, update description to "19 tools".

### package.json

Bump version to `1.4.0`.

## Skill Designs

### 1. k8s-statefulset

**API:** AppsV1Api (existing)

| Action | Description | Key Params |
|--------|-------------|------------|
| `list` | List StatefulSets | namespace, all_namespaces, label_selector |
| `describe` | Details with Pod list and PVC bindings | statefulset_name, namespace |
| `status` | Quick status (ready/current/updated replicas) | statefulset_name, namespace |
| `scale` | Scale replicas | statefulset_name, replicas |
| `rollout_restart` | Trigger rolling restart | statefulset_name |
| `rollout_undo` | Rollback to revision | statefulset_name, to_revision |
| `update_image` | Update container image | statefulset_name, container, image |

**Special:** `describe` correlates PVCs owned by the StatefulSet.

### 2. k8s-daemonset

**API:** AppsV1Api (existing)

| Action | Description | Key Params |
|--------|-------------|------------|
| `list` | List DaemonSets | namespace, all_namespaces, label_selector |
| `describe` | Details with node coverage | daemonset_name, namespace |
| `status` | Quick status (desired/current/ready/misscheduled) | daemonset_name, namespace |
| `rollout_restart` | Trigger rolling restart | daemonset_name |
| `update_image` | Update container image | daemonset_name, container, image |

**Special:** `status` shows node coverage ratio (ready/desired).

### 3. k8s-job

**API:** BatchV1Api (new)

| Action | Description | Key Params |
|--------|-------------|------------|
| `list` | List Jobs | namespace, all_namespaces, label_selector |
| `describe` | Details with completion conditions and Pod status | job_name, namespace |
| `status` | Quick status (active/succeeded/failed) | job_name, namespace |
| `logs` | Get Job Pod logs | job_name, namespace, tail_lines |
| `delete` | Delete Job and associated Pods | job_name, namespace |
| `create` | Create one-off Job from image | job_name, image, command, namespace |

### 4. k8s-cronjob

**API:** BatchV1Api (new)

| Action | Description | Key Params |
|--------|-------------|------------|
| `list` | List CronJobs | namespace, all_namespaces, label_selector |
| `describe` | Details with schedule and recent executions | cronjob_name, namespace |
| `status` | Recent execution history and next trigger time | cronjob_name, namespace |
| `suspend` | Suspend/resume scheduling | cronjob_name, suspend(bool) |
| `trigger` | Manually trigger execution | cronjob_name, namespace |
| `history` | View associated Job history | cronjob_name, namespace, limit |

**Special:** `trigger` creates a manual Job with `-manual-` suffix.

### 5. k8s-hpa

**API:** AutoscalingV2Api (new)

| Action | Description | Key Params |
|--------|-------------|------------|
| `list` | List HPAs | namespace, all_namespaces, label_selector |
| `describe` | Details with current vs target metric values | hpa_name, namespace |
| `status` | Current replicas vs min/max, metric status | hpa_name, namespace |
| `create` | Create HPA | hpa_name, target_ref, min/max_replicas, cpu_target |
| `update` | Update min/max/metric targets | hpa_name, min/max_replicas, cpu_target |
| `delete` | Delete HPA | hpa_name, namespace |

Uses AutoscalingV2Api for custom metrics display.

## File Structure

Each skill follows the established pattern:

```
skills/k8s-{name}/
├── SKILL.md
└── src/
    └── {name}.ts
```

## Implementation Order

1. `lib/client.ts` — add BatchV1Api + AutoscalingV2Api
2. `k8s-statefulset` — closest to existing k8s-deploy pattern
3. `k8s-daemonset` — similar to StatefulSet, simpler (no scale)
4. `k8s-job` — introduces BatchV1Api usage
5. `k8s-cronjob` — builds on Job, adds scheduling
6. `k8s-hpa` — introduces AutoscalingV2Api
7. `index.ts` — register all 5, update description
8. `package.json` — bump to v1.4.0
