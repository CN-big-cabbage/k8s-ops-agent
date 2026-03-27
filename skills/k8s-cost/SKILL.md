---
name: k8s-cost
description: |
  Kubernetes cost and resource efficiency analysis. Activate when user mentions cost, resource usage, overprovisioned, underprovisioned, idle resources, rightsizing, or efficiency on K8s.
---

# Kubernetes Cost Analysis Tool

Single tool `k8s_cost` with action parameter for resource efficiency analysis.

## Actions

### Namespace Usage

```json
{ "action": "namespace_usage", "namespace": "production" }
{ "action": "namespace_usage", "all_namespaces": true }
```

### Overprovisioned Resources

```json
{ "action": "overprovisioned", "namespace": "production" }
{ "action": "overprovisioned", "all_namespaces": true, "threshold": 50 }
```

### Underprovisioned Resources

```json
{ "action": "underprovisioned", "namespace": "production" }
```

### Idle Resources

```json
{ "action": "idle_resources", "namespace": "production" }
{ "action": "idle_resources", "all_namespaces": true }
```

### Recommendations

```json
{ "action": "recommendations", "namespace": "production" }
```
