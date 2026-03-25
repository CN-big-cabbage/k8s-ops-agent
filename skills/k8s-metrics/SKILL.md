---
name: k8s-metrics
description: |
  Kubernetes resource metrics and monitoring. Activate when user wants to check CPU/memory usage, find resource-hungry pods, view node capacity, or generate capacity planning reports. Requires Metrics Server installed in the cluster.
---

# Kubernetes Metrics Tool

Single tool `k8s_metrics` with action parameter for resource monitoring operations.

## Prerequisites

Requires [Metrics Server](https://github.com/kubernetes-sigs/metrics-server) installed in the cluster.

## Actions

### Pod Resources

View CPU/memory usage for a specific pod:

```json
{
  "action": "pod_resources",
  "namespace": "default",
  "pod_name": "nginx-abc123"
}
```

### Node Resources

View resource usage and capacity for a node:

```json
{
  "action": "node_resources",
  "node_name": "worker-01"
}
```

### Top Pods

Find top N pods by resource consumption:

```json
{
  "action": "top_pods",
  "namespace": "production",
  "sort_by": "memory",
  "top_n": 10
}
```

### Top Nodes

Find top N nodes by resource consumption:

```json
{
  "action": "top_nodes",
  "sort_by": "cpu",
  "top_n": 5
}
```

### Namespace Usage

Namespace-level resource summary:

```json
{
  "action": "namespace_usage",
  "namespace": "production"
}
```

### Capacity Report

Cluster-wide capacity planning report:

```json
{
  "action": "capacity_report"
}
```

## Common Workflows

### Investigate High Resource Usage

1. Check top pods: `{ "action": "top_pods", "namespace": "production", "sort_by": "cpu" }`
2. Drill into specific pod: `{ "action": "pod_resources", "pod_name": "api-server-xyz" }`
3. Check node capacity: `{ "action": "node_resources", "node_name": "worker-01" }`

### Capacity Planning

1. Generate report: `{ "action": "capacity_report" }`
2. Check namespace usage: `{ "action": "namespace_usage", "namespace": "production" }`
3. Find top consumers: `{ "action": "top_nodes", "sort_by": "memory" }`

## Permissions Required

- `pods` - Get/list pod metrics (metrics.k8s.io)
- `nodes` - Get/list node metrics (metrics.k8s.io)
- `nodes` - Get node capacity info
- `pods` - List pods for namespace usage calculation
