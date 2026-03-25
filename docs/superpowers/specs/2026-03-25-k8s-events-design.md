# k8s-events & k8s-event-analysis Design Spec

Phase 3: Event monitoring and anomaly detection for the k8s-ops-agent plugin.

## Overview

Two new skills that provide Kubernetes event querying, filtering, anomaly detection, and cross-resource correlation. Split into a basic layer (k8s-events) and an advanced analysis layer (k8s-event-analysis).

After implementation, the plugin will have 9 skills total (current 7 + 2 new).

## Architecture

### Skill Split

| Skill | Tool Name | Actions | Purpose |
|-------|-----------|---------|---------|
| k8s-events | `k8s_events` | list, filter, recent, export | Basic event querying and export |
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
  action: z.enum(["list", "filter", "recent", "export"]),
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
- Ignores filter params (`resource_kind`, `event_type`, `reason`). Use `filter` for conditional queries.
- Output: table with TIME, TYPE, REASON, OBJECT, MESSAGE columns.

**filter** — Filter events by criteria.
- Combines `resource_kind`, `resource_name`, `event_type`, `reason` as AND conditions.
- At least one filter parameter is required; returns error if none provided (use `list` instead).
- Client-side filtering on K8s API results (fieldSelector where possible).

**recent** — Show events from the last N minutes.
- Filters by event timestamp >= now - `since_minutes`.
- Timestamp resolution: uses `lastTimestamp` if available, falls back to `eventTime`, then `metadata.creationTimestamp`.
- Same output format as list but scoped to time window.
- Note: This is NOT a K8s watch (streaming). It's a point-in-time query.

**export** — Export event data.
- `format: "table"` — formatted ASCII table (default).
- `format: "json"` — structured JSON array for programmatic consumption.
- Supports all filter params to scope export.

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
- Warning buckets marked with `[!]` prefix.

Output example:
```
Event Timeline: namespace=default (last 1h, 5min buckets)

TIME RANGE          NORMAL  WARNING  DETAILS
14:00-14:05              3        0  Scheduled(2), Pulled(1)
14:05-14:10              1        0  Started(1)
14:10-14:15              0        2  [!] BackOff(2)
14:15-14:20              2        1  [!] Scheduled(2), FailedMount(1)
14:20-14:25              4        0  Pulling(2), Pulled(2)
...

Total: 25 events across 12 buckets (20 Normal, 5 Warning)
```

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

Output example:
```
Anomaly Report: namespace=production (last 30min, threshold=5)

CRITICAL ANOMALIES:
  CrashLoopBackOff  Pod/api-svc-abc123       8 events in 15min
  OOMKilled         Pod/worker-xyz           3 events in 10min

HIGH-FREQUENCY WARNINGS:
  Pod/cache-redis-01   12 Warning events (threshold: 5)
  Pod/api-svc-abc123    8 Warning events (threshold: 5)

Summary: 2 known anomaly patterns, 2 high-frequency resources
Status: ACTION REQUIRED
```

**correlate** — Full chain event correlation.

Supported `resource_kind` values and their traversal behavior:

| Input Kind | Traversal Direction | Resources Collected |
|-----------|-------------------|-------------------|
| `Pod` | Up + sideways | Pod → (ownerRef) RS → (ownerRef) Deploy; Pod → (nodeName) Node |
| `Deployment` | Down | Deploy → (owned) RS → (owned) Pods → (nodeName) Nodes |
| `ReplicaSet` | Up + Down | RS → (ownerRef) Deploy; RS → (owned) Pods |
| `Node` | Down | Node → all Pods scheduled on it |
| Other (Service, ConfigMap, etc.) | Self only | Query events for that resource only, no chain traversal |

Given a resource (kind + name):
1. Query events for the resource itself.
2. Based on kind (see table above), traverse the ownership chain to discover related resources.
3. For Pod → Node correlation: Node events live in the `default` namespace regardless of the Pod's namespace. Query Node events with `namespace: "default"`.
4. Aggregate all events across the chain, sorted by time.
5. Group output by resource, showing the chain relationship.

Implementation:
- `CoreV1Api.readNamespacedPod()` — get ownerReferences and nodeName.
- `AppsV1Api.readNamespacedReplicaSet()` — get Deployment owner.
- `CoreV1Api.listNamespacedEvent()` — query events per resource. Use `default` namespace for Node events.
- For "Deployment down" traversal: `AppsV1Api.listNamespacedReplicaSet()` with label selector, then `CoreV1Api.listNamespacedPod()`.

`resource_kind` and `resource_name` are both required for correlate. Return error if either is missing.

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
- Deduct 10 points per active CrashLoopBackOff (max 30 deduction)
- Deduct 10 points per OOMKilled (max 30 deduction)
- Deduct 8 points per FailedScheduling (max 24 deduction)
- Deduct 5 points per other known anomaly pattern (max 15 deduction)
- Floor at 0
```

Each anomaly category has its own cap to prevent a single category from dominating the score.

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

No new RBAC permissions needed. The existing config already includes:

```yaml
- apiGroups: [""]
  resources: ["events"]
  verbs: ["get", "list"]
```

All actions use `list` API calls (no K8s Watch streaming).

## K8s API Dependencies

| API | Method | Used By |
|-----|--------|---------|
| CoreV1Api | `listNamespacedEvent()` | list, filter, recent, export, all analysis |
| CoreV1Api | `listEventForAllNamespaces()` | all_namespaces=true |
| CoreV1Api | `readNamespacedPod()` | correlate (ownerReference chain) |
| AppsV1Api | `readNamespacedReplicaSet()` | correlate (RS → Deploy chain) |
| AppsV1Api | `listNamespacedReplicaSet()` | correlate (Deploy → RS down traversal) |
| CoreV1Api | `listNamespacedPod()` | correlate (RS → Pod down traversal) |

### Event Timestamp Resolution

K8s `CoreV1Event` has multiple timestamp fields. Use this fallback order:
1. `lastTimestamp` (preferred, most recent occurrence)
2. `eventTime` (newer Events API field)
3. `metadata.creationTimestamp` (always present)

Export this as a utility: `getEventTimestamp(event): Date`.

## Implementation Order

1. k8s-events (basic layer) — implementation + tests
2. k8s-event-analysis (advanced layer) — implementation + tests
3. Integration (index.ts, README, version bump)
4. Full test suite validation
5. Commit and push

## Constraints

- Follow existing skill patterns exactly (Zod schema, switch-based handler, wrapK8sError).
- Apply `truncateOutput()` to the final return value in each handler function (before returning from handleK8sEvents/handleK8sEventAnalysis).
- Support multi-cluster via `context` parameter.
- All pure logic functions exported for testability.
- SKILL.md for each skill should follow existing format: YAML frontmatter (name, description), Actions section with JSON examples, Common Workflows, Safety Notes, Permissions Required.
