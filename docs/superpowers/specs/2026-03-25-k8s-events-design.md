# k8s-events & k8s-event-analysis Design Spec

Phase 3: Event monitoring and anomaly detection for the k8s-ops-agent plugin.

## Overview

Two new skills that provide Kubernetes event querying, filtering, anomaly detection, and cross-resource correlation. Split into a basic layer (k8s-events) and an advanced analysis layer (k8s-event-analysis).

After implementation, the plugin will have 9 skills total (current 7 + 2 new).

## Architecture

### Skill Split

| Skill | Tool Name | Actions | Purpose |
|-------|-----------|---------|---------|
| k8s-events | `k8s_events` | list, filter, watch, export | Basic event querying and export |
| k8s-event-analysis | `k8s_event_analysis` | timeline, anomaly, correlate, summary | Advanced analysis and anomaly detection |

### Directory Structure

```
skills/
├── k8s-events/
│   ├── src/
│   │   ├── events.ts          # Core implementation (~300 lines)
│   │   └── events.test.ts     # Unit tests
│   └── SKILL.md               # Documentation
├── k8s-event-analysis/
│   ├── src/
│   │   ├── analysis.ts        # Core implementation (~400 lines)
│   │   └── analysis.test.ts   # Unit tests
│   └── SKILL.md               # Documentation
```

## k8s-events (Basic Layer)

### Schema

```typescript
const K8sEventsSchema = z.object({
  action: z.enum(["list", "filter", "watch", "export"]),
  namespace: z.string().default(DEFAULT_NAMESPACE),
  all_namespaces: z.boolean().default(false),
  resource_kind: z.string().optional(),     // "Pod", "Deployment", "Node"
  resource_name: z.string().optional(),
  event_type: z.enum(["Normal", "Warning"]).optional(),
  reason: z.string().optional(),            // "BackOff", "FailedScheduling", etc.
  since_minutes: z.number().int().positive().default(60),
  format: z.enum(["json", "table"]).default("table"),
  limit: z.number().int().positive().default(50),
  context: z.string().optional(),
});
```

### Actions

**list** — List recent events, sorted by time descending.
- Uses `listNamespacedEvent()` or `listEventForAllNamespaces()` based on `all_namespaces`.
- Respects `limit` parameter.
- Output: table with TIME, TYPE, REASON, OBJECT, MESSAGE columns.

**filter** — Filter events by criteria.
- Combines `resource_kind`, `resource_name`, `event_type`, `reason` as AND conditions.
- Client-side filtering on K8s API results (fieldSelector where possible).

**watch** — Show events from the last N minutes.
- Filters by `lastTimestamp >= now - since_minutes`.
- Same output format as list but scoped to time window.

**export** — Export event data.
- `format: "table"` — formatted ASCII table (default).
- `format: "json"` — structured JSON array for programmatic consumption.

### Output Example (list)

```
Events in namespace: default (last 50)

TIME         TYPE     REASON           OBJECT              MESSAGE
2m ago       Normal   Scheduled        Pod/nginx-abc123    Successfully assigned default/nginx-abc123 to node-01
5m ago       Warning  BackOff          Pod/api-xyz         Back-off restarting failed container
10m ago      Normal   Pulling          Pod/nginx-abc123    Pulling image "nginx:latest"
15m ago      Warning  FailedScheduling Pod/worker-123      0/3 nodes are available: insufficient cpu

Total: 4 events (2 Normal, 2 Warning)
```

## k8s-event-analysis (Advanced Layer)

### Schema

```typescript
const K8sEventAnalysisSchema = z.object({
  action: z.enum(["timeline", "anomaly", "correlate", "summary"]),
  namespace: z.string().default(DEFAULT_NAMESPACE),
  all_namespaces: z.boolean().default(false),
  since_minutes: z.number().int().positive().default(60),
  resource_kind: z.string().optional(),
  resource_name: z.string().optional(),
  warning_threshold: z.number().int().positive().default(5),
  time_window_minutes: z.number().int().positive().default(30),
  context: z.string().optional(),
});
```

### Actions

**timeline** — Time-bucketed event visualization.
- Groups events into 5-minute buckets within `since_minutes` window.
- Shows event count and type per bucket.
- Highlights buckets with Warning events.

**anomaly** — Rule-based anomaly detection.

Known anomaly patterns detected:
- `CrashLoopBackOff` — Pod crash loop
- `OOMKilled` — Out of memory
- `FailedScheduling` — Cannot schedule
- `Evicted` — Pod evicted
- `FailedMount` — Volume mount failure
- `ImagePullBackOff` — Image pull failure
- `NodeNotReady` — Node failure

High-frequency detection:
- Same resource with >= `warning_threshold` Warning events within `time_window_minutes`.

**correlate** — Full chain event correlation.

Given a resource (kind + name):
1. Query events for the resource itself.
2. Traverse `ownerReference` chain: Pod → ReplicaSet → Deployment.
3. For Pods, also find events on the scheduled Node (via `spec.nodeName`).
4. Aggregate all events across the chain, sorted by time.

Implementation:
- `CoreV1Api.readNamespacedPod()` — get ownerReferences and nodeName.
- `AppsV1Api.readNamespacedReplicaSet()` — get Deployment owner.
- Query events for each discovered resource.

**summary** — Namespace event health summary.

Output includes:
- Health score (0-100) based on Warning/Normal ratio and known anomaly patterns.
- Event type breakdown (Normal vs Warning count and percentage).
- Top Warning reasons with affected resource count.
- Most active resources by event count.

### Health Score Calculation

```
baseScore = 100
- Deduct 2 points per Warning event (max 40 deduction)
- Deduct 10 points per active CrashLoopBackOff
- Deduct 10 points per OOMKilled
- Deduct 8 points per FailedScheduling
- Deduct 5 points per other known anomaly pattern
- Floor at 0
```

### Summary Output Example

```
Event Summary: namespace=production (last 1h)

Health Score: 72/100

Event Types:
  Normal:  45 (75%)
  Warning: 15 (25%)

Top Warning Reasons:
  BackOff:          8 events (5 pods)
  FailedScheduling: 4 events (2 pods)
  OOMKilled:        3 events (1 pod)

Most Active Resources:
  Pod/api-svc-xyz:     12 events
  Node/node-02:         8 events
  Deploy/payment-gw:    5 events
```

## Shared Utilities

Both skills use existing lib/ utilities:
- `createK8sClients()` — K8s client factory with caching.
- `wrapK8sError()` — Unified error formatting.
- `formatTable()` — ASCII table output.
- `formatAge()` — Time-relative formatting.
- `truncateOutput()` — 10KB output limit.

No new shared utilities needed.

## Testing Strategy

### events.test.ts

Unit tests for exportable pure functions:
- `filterEvents(events, criteria)` — event filtering logic.
- Schema validation (valid/invalid inputs, defaults).
- Time-based filtering logic.
- Export format rendering.

Target: ~10-12 tests.

### analysis.test.ts

Unit tests for exportable pure functions:
- `detectAnomalies(events, rules)` — anomaly pattern matching.
- `calculateHealthScore(eventStats)` — score computation.
- `buildCorrelationChain(events, resource)` — chain building.
- `groupEventsByTimeBucket(events, bucketMinutes)` — timeline bucketing.

Target: ~12-15 tests.

### Total expected: ~22-27 new tests.

## Integration

### index.ts Changes

```typescript
import { registerK8sEventsTools } from "./skills/k8s-events/src/events.js";
import { registerK8sEventAnalysisTools } from "./skills/k8s-event-analysis/src/analysis.js";

// In load():
registerK8sEventsTools(api);
registerK8sEventAnalysisTools(api);
api.log("K8s plugin loaded successfully - 9 skills registered");
```

### Version Bump

`package.json` version: `1.2.0` → `1.3.0`

### README Updates

Both README.md and README_CN.md:
- Move k8s-events from "Planned Skills" to main skills list.
- Add k8s-event-analysis as new skill.
- Update skill count: 7 → 9.
- Add usage examples for events and analysis actions.
- Add RBAC permission for events watch.

### RBAC Addition

```yaml
- apiGroups: [""]
  resources: ["events"]
  verbs: ["get", "list", "watch"]
```

Note: events "get" and "list" are already in the existing RBAC config. Only "watch" is new.

## K8s API Dependencies

| API | Method | Used By |
|-----|--------|---------|
| CoreV1Api | `listNamespacedEvent()` | list, filter, watch, export, all analysis |
| CoreV1Api | `listEventForAllNamespaces()` | all_namespaces=true |
| CoreV1Api | `readNamespacedPod()` | correlate (ownerReference chain) |
| AppsV1Api | `readNamespacedReplicaSet()` | correlate (RS → Deploy chain) |

## Implementation Order

1. k8s-events (basic layer) — implementation + tests
2. k8s-event-analysis (advanced layer) — implementation + tests
3. Integration (index.ts, README, version bump)
4. Full test suite validation
5. Commit and push

## Constraints

- Follow existing skill patterns exactly (Zod schema, switch-based handler, wrapK8sError).
- Output within 10KB limit (truncateOutput).
- Support multi-cluster via `context` parameter.
- All pure logic functions exported for testability.
