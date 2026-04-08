---
name: k8s-ops
description: Kubernetes operations plugin — 32 tools for cluster management, monitoring, troubleshooting, and security auditing
metadata:
  openclaw:
    requires:
      bins:
        - kubectl
---

# k8s-ops

Kubernetes operations plugin for OpenClaw. Provides 32 tools covering the full lifecycle of K8s cluster management.

## Tools

- **Pod Management**: list, inspect, exec, logs, port-forward
- **Deployments**: status, rollout, scale, restart
- **Services & Networking**: services, ingress, gateway, network policies
- **Workloads**: jobs, cronjobs, daemonsets, statefulsets, HPA
- **Storage**: PV/PVC management
- **Security**: RBAC audit, security scanning, pod security policies
- **Observability**: events, metrics, health checks, cost analysis
- **Troubleshooting**: diagnostics, topology, event analysis
- **Advanced**: CRDs, Helm releases, PDB, YAML generation, namespace management

## Requirements

- `kubectl` installed and configured with cluster access
- Valid kubeconfig (defaults to `~/.kube/config`)

## Configuration

Optional plugin config:

| Field | Description |
|-------|-------------|
| `kubeconfigPath` | Custom path to kubeconfig file |
| `defaultContext` | Default Kubernetes context to use |
| `hosts` | SSH target hosts for sys-monitor tool |
