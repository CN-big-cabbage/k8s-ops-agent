---
name: k8s-pdb
description: |
  Kubernetes PodDisruptionBudget operations. Activate when user mentions PDB, pod disruption budget, disruption protection, or availability guarantees on K8s.
---

# Kubernetes PDB Tool

Single tool `k8s_pdb` with action parameter for all PodDisruptionBudget operations.

## Actions

### List PDBs

```json
{ "action": "list", "namespace": "default" }
{ "action": "list", "all_namespaces": true }
```

### Describe PDB

```json
{ "action": "describe", "pdb_name": "web-pdb", "namespace": "default" }
```

### Status

```json
{ "action": "status", "pdb_name": "web-pdb" }
```

### Create PDB

```json
{ "action": "create", "pdb_name": "web-pdb", "namespace": "default", "target_selector": "app=web", "min_available": "50%" }
{ "action": "create", "pdb_name": "db-pdb", "namespace": "default", "target_selector": "app=db", "max_unavailable": 1 }
```

### Delete PDB

```json
{ "action": "delete", "pdb_name": "web-pdb", "namespace": "default" }
```

### Check Workload Protection

```json
{ "action": "check", "workload_name": "Deployment/web", "namespace": "default" }
```
