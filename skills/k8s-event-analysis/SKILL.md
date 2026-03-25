---
name: k8s-event-analysis
description: |
  Kubernetes event analysis. Activate when user wants event timelines, anomaly detection, cross-resource event correlation, or namespace health summaries.
---

# Kubernetes Event Analysis Tool

Single tool `k8s_event_analysis` with action parameter for advanced event analysis. For basic event querying, use `k8s_events`.

## Actions

### Timeline

Visualize events as time-bucketed timeline:

```json
{
  "action": "timeline",
  "namespace": "production",
  "since_minutes": 60
}
```

### Anomaly Detection

Detect known anomaly patterns and high-frequency warnings:

```json
{
  "action": "anomaly",
  "namespace": "production",
  "warning_threshold": 5,
  "time_window_minutes": 30
}
```

Detects: CrashLoopBackOff, OOMKilled, FailedScheduling, Evicted, FailedMount, ImagePullBackOff, NodeNotReady.

### Event Correlation

Full chain event correlation across resources:

```json
{
  "action": "correlate",
  "namespace": "production",
  "resource_kind": "Pod",
  "resource_name": "api-server-abc123"
}
```

Traverses: Pod → ReplicaSet → Deployment → Node. Also supports starting from Deployment, ReplicaSet, or Node.

### Health Summary

Namespace event health summary with score:

```json
{
  "action": "summary",
  "namespace": "production",
  "since_minutes": 60
}
```

## Common Workflows

### Investigate Degraded Service

1. Check health: `{ "action": "summary", "namespace": "production" }`
2. Detect anomalies: `{ "action": "anomaly", "namespace": "production" }`
3. Correlate a failing pod: `{ "action": "correlate", "resource_kind": "Pod", "resource_name": "api-xyz" }`

### Deployment Monitoring

1. View timeline: `{ "action": "timeline", "namespace": "production", "since_minutes": 15 }`
2. Correlate deployment: `{ "action": "correlate", "resource_kind": "Deployment", "resource_name": "api-service" }`

## Permissions Required

- `events/list` - List events
- `events/get` - Get event details
- `pods/get` - Read pod details (for correlate)
- `replicasets/get` - Read RS details (for correlate)
- `replicasets/list` - List RS (for correlate)
- `pods/list` - List pods (for correlate)
