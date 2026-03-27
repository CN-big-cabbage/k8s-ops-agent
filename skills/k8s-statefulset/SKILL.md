---
name: k8s-statefulset
description: |
  Kubernetes StatefulSet operations. Activate when user mentions statefulsets, stateful applications, databases on K8s, or ordered pod management.
---

# Kubernetes StatefulSet Tool

Single tool `k8s_statefulset` with action parameter for all StatefulSet operations.

## Actions

### List StatefulSets

```json
{ "action": "list", "namespace": "default" }
{ "action": "list", "all_namespaces": true }
{ "action": "list", "label_selector": "app=mysql" }
```

### Describe StatefulSet

```json
{ "action": "describe", "statefulset_name": "mysql", "namespace": "default" }
```

### Status

```json
{ "action": "status", "statefulset_name": "mysql" }
```

### Scale

```json
{ "action": "scale", "statefulset_name": "mysql", "replicas": 5 }
```

### Rollout Restart

```json
{ "action": "rollout_restart", "statefulset_name": "mysql" }
```

### Rollout Undo

```json
{ "action": "rollout_undo", "statefulset_name": "mysql" }
{ "action": "rollout_undo", "statefulset_name": "mysql", "to_revision": 2 }
```

### Update Image

```json
{ "action": "update_image", "statefulset_name": "mysql", "container": "mysql", "image": "mysql:8.1" }
```
