---
name: k8s-crd
description: |
  Kubernetes CRD operations. Activate when user mentions CRD, custom resource definition, custom resources, CR instances, or operator resources on K8s.
---

# Kubernetes CRD Tool

Single tool `k8s_crd` with action parameter for all Custom Resource Definition operations.

## Actions

### List CRD Definitions

```json
{ "action": "list_definitions" }
{ "action": "list_definitions", "label_selector": "app=cert-manager" }
```

### Describe CRD Definition

```json
{ "action": "describe_definition", "crd_name": "certificates.cert-manager.io" }
```

### List CR Instances

```json
{ "action": "list_resources", "group": "cert-manager.io", "version": "v1", "plural": "certificates", "namespace": "default" }
{ "action": "list_resources", "crd_name": "certificates.cert-manager.io", "all_namespaces": true }
```

### Describe CR Instance

```json
{ "action": "describe_resource", "group": "cert-manager.io", "version": "v1", "plural": "certificates", "resource_name": "my-cert", "namespace": "default" }
```

### Delete CR Instance

```json
{ "action": "delete_resource", "group": "cert-manager.io", "version": "v1", "plural": "certificates", "resource_name": "my-cert", "namespace": "default" }
```
