---
name: k8s-rbac
description: |
  Kubernetes RBAC operations. Activate when user mentions RBAC, roles, clusterroles, rolebindings, service accounts, permissions, or authorization on K8s.
---

# Kubernetes RBAC Tool

Single tool `k8s_rbac` with action parameter for all RBAC operations.

## Actions

### List ServiceAccounts

```json
{ "action": "list_sa", "namespace": "default" }
{ "action": "list_sa", "all_namespaces": true }
```

### Describe ServiceAccount

```json
{ "action": "describe_sa", "name": "my-sa", "namespace": "default" }
```

### List Roles / ClusterRoles

```json
{ "action": "list_roles", "namespace": "default" }
{ "action": "list_roles", "cluster_scope": true }
```

### Describe Role / ClusterRole

```json
{ "action": "describe_role", "name": "pod-reader", "namespace": "default" }
{ "action": "describe_role", "name": "cluster-admin", "cluster_scope": true }
```

### List Bindings

```json
{ "action": "list_bindings", "namespace": "default" }
{ "action": "list_bindings", "cluster_scope": true }
```

### Describe Binding

```json
{ "action": "describe_binding", "name": "read-pods", "namespace": "default" }
{ "action": "describe_binding", "name": "cluster-admin-binding", "cluster_scope": true }
```

### Who Can

```json
{ "action": "who_can", "verb": "get", "resource": "pods", "namespace": "default" }
```

### Audit ServiceAccounts

```json
{ "action": "audit_sa", "namespace": "default" }
{ "action": "audit_sa", "all_namespaces": true }
```
