---
name: k8s-daemonset
description: |
  Kubernetes DaemonSet operations. Activate when user mentions daemonsets, node-level agents, log collectors, or monitoring agents on K8s.
---

# Kubernetes DaemonSet Tool

Single tool `k8s_daemonset` with action parameter for all DaemonSet operations.

## Actions

### List DaemonSets

```json
{ "action": "list", "namespace": "kube-system" }
{ "action": "list", "all_namespaces": true }
```

### Describe DaemonSet

```json
{ "action": "describe", "daemonset_name": "fluentd", "namespace": "kube-system" }
```

### Status

```json
{ "action": "status", "daemonset_name": "fluentd", "namespace": "kube-system" }
```

### Rollout Restart

```json
{ "action": "rollout_restart", "daemonset_name": "fluentd", "namespace": "kube-system" }
```

### Update Image

```json
{ "action": "update_image", "daemonset_name": "fluentd", "namespace": "kube-system", "container": "fluentd", "image": "fluentd:v1.17" }
```
