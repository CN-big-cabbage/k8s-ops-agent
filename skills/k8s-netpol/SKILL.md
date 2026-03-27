---
name: k8s-netpol
description: |
  Kubernetes NetworkPolicy operations. Activate when user mentions network policies, netpol, ingress/egress rules, pod isolation, or network security on K8s.
---

# Kubernetes NetworkPolicy Tool

Single tool `k8s_netpol` with action parameter for all NetworkPolicy operations.

## Actions

### List NetworkPolicies

```json
{ "action": "list", "namespace": "default" }
{ "action": "list", "all_namespaces": true }
```

### Describe NetworkPolicy

```json
{ "action": "describe", "policy_name": "deny-all", "namespace": "default" }
```

### Check Pod Policies

```json
{ "action": "check_pod", "pod_name": "web-abc123", "namespace": "default" }
```

### Create NetworkPolicy

```json
{ "action": "create", "policy_name": "allow-monitoring", "namespace": "default", "pod_selector": "app=web", "ingress_allow": "namespace=monitoring", "egress_allow": "cidr=10.0.0.0/8" }
```

### Delete NetworkPolicy

```json
{ "action": "delete", "policy_name": "deny-all", "namespace": "default" }
```

### Audit Namespaces

```json
{ "action": "audit" }
```
