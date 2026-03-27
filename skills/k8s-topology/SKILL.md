---
name: k8s-topology
description: |
  Kubernetes resource topology mapping. Activate when user mentions topology, resource chain, service chain, workload chain, pod dependencies, namespace map, or resource relationships on K8s.
---

# Kubernetes Topology Tool

Single tool `k8s_topology` with action parameter for resource topology mapping.

## Actions

### Service Chain

```json
{ "action": "service_chain", "name": "web-svc", "namespace": "default" }
```

### Workload Chain

```json
{ "action": "workload_chain", "name": "web", "namespace": "default" }
```

### Pod Dependencies

```json
{ "action": "pod_dependencies", "pod_name": "web-abc-1234", "namespace": "default" }
```

### Namespace Map

```json
{ "action": "namespace_map", "namespace": "default" }
```
