---
name: k8s-health
description: |
  Kubernetes cluster health check. Activate when user mentions health check, cluster inspection, cluster health, node health, workload health, certificate expiry, or storage health on K8s.
---

# Kubernetes Health Check Tool

Single tool `k8s_health` with action parameter for cluster health inspection.

## Actions

### Full Cluster Health Check

```json
{ "action": "cluster" }
{ "action": "cluster", "namespace": "production" }
```

### Node Health

```json
{ "action": "nodes" }
```

### Workload Health

```json
{ "action": "workloads", "namespace": "default" }
{ "action": "workloads", "all_namespaces": true }
```

### Networking Health

```json
{ "action": "networking", "namespace": "default" }
```

### Storage Health

```json
{ "action": "storage" }
```

### Certificate Expiry Check

```json
{ "action": "certificates", "namespace": "default" }
{ "action": "certificates", "all_namespaces": true }
```
