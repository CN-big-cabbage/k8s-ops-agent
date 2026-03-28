---
name: k8s-security
description: |
  Kubernetes security audit and compliance. Activate when user mentions security scan, PSA compliance, secret audit, image audit, privileged pods, or security posture on K8s.
---

# Kubernetes Security Tool

Single tool `k8s_security` with action parameter for security audit operations.

## Actions

### Scan Namespace

```json
{ "action": "scan_namespace", "namespace": "production" }
```

### Check PSA Compliance

```json
{ "action": "check_psa", "namespace": "default" }
```

### Secret Audit

```json
{ "action": "secret_audit", "namespace": "default" }
{ "action": "secret_audit", "all_namespaces": true }
```

### Image Audit

```json
{ "action": "image_audit", "namespace": "default" }
```

### Find Privileged Pods

```json
{ "action": "privileged_pods", "namespace": "default" }
{ "action": "privileged_pods", "all_namespaces": true }
```
