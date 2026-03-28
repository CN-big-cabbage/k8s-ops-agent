---
name: k8s-hpa
description: |
  Kubernetes HPA operations. Activate when user mentions autoscaling, HPA, horizontal pod autoscaler, or scaling policies on K8s.
---

# Kubernetes HPA Tool

Single tool `k8s_hpa` with action parameter for all HPA operations.

## Actions

### List HPAs

```json
{ "action": "list", "namespace": "default" }
{ "action": "list", "all_namespaces": true }
```

### Describe HPA

```json
{ "action": "describe", "hpa_name": "web-hpa" }
```

### Status

```json
{ "action": "status", "hpa_name": "web-hpa" }
```

### Create HPA

```json
{ "action": "create", "hpa_name": "web-hpa", "target_ref": "Deployment/web", "min_replicas": 2, "max_replicas": 10, "cpu_target": 80 }
```

### Update HPA

```json
{ "action": "update", "hpa_name": "web-hpa", "min_replicas": 3, "max_replicas": 15 }
{ "action": "update", "hpa_name": "web-hpa", "cpu_target": 70 }
```

### Delete HPA

```json
{ "action": "delete", "hpa_name": "web-hpa" }
```
