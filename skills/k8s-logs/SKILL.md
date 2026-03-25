---
name: k8s-logs
description: |
  Advanced Kubernetes log operations. Activate when user wants to search logs, aggregate multi-pod logs, compare pod logs, get log statistics, or export logs.
---

# Kubernetes Advanced Logs Tool

Single tool `k8s_logs` with action parameter for advanced log operations. For basic single-pod log viewing, use `k8s_pod` with action `logs`.

## Actions

### Search Logs

Search pod logs by keyword or regex:

```json
{
  "action": "search",
  "namespace": "default",
  "pod_name": "app-abc123",
  "pattern": "ERROR|WARN",
  "tail_lines": 500
}
```

### Multi-Pod Logs

Aggregate logs from multiple pods by label:

```json
{
  "action": "multi_pod",
  "namespace": "production",
  "label_selector": "app=api-server",
  "tail_lines": 100
}
```

### Logs Since Time

View logs within a time range:

```json
{
  "action": "since",
  "namespace": "default",
  "pod_name": "app-abc123",
  "since_time": "1h"
}
```

Supports relative time (`1h`, `30m`, `7d`) and ISO 8601 (`2026-03-24T10:00:00Z`).

### Compare Pod Logs

Side-by-side comparison of two pods:

```json
{
  "action": "compare",
  "namespace": "default",
  "compare_pods": ["app-pod-1", "app-pod-2"],
  "tail_lines": 50
}
```

### Log Statistics

Analyze log patterns and error frequencies:

```json
{
  "action": "stats",
  "namespace": "default",
  "pod_name": "app-abc123",
  "tail_lines": 1000
}
```

### Export Logs

Export logs as structured JSON:

```json
{
  "action": "export",
  "namespace": "default",
  "pod_name": "app-abc123",
  "tail_lines": 200
}
```

## Common Workflows

### Investigate Spike in Errors

1. Get log stats: `{ "action": "stats", "pod_name": "api-server-xyz", "tail_lines": 1000 }`
2. Search for specific error: `{ "action": "search", "pod_name": "api-server-xyz", "pattern": "connection refused" }`
3. Compare with healthy pod: `{ "action": "compare", "compare_pods": ["api-server-good", "api-server-bad"] }`

### Monitor a Deployment Rollout

1. Aggregate logs across all pods: `{ "action": "multi_pod", "label_selector": "app=api", "since_time": "5m" }`
2. Search specific pod for errors: `{ "action": "search", "pod_name": "api-server-xyz", "pattern": "ERROR|panic|fatal", "since_time": "5m" }`

## Permissions Required

- `pods/log` - Read pod logs
- `pods/list` - List pods (for multi_pod action)
