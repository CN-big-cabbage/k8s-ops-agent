# OpenClaw Kubernetes Plugin

English | [简体中文](README_CN.md)

Kubernetes operations plugin for OpenClaw, providing tools to manage K8s resources.

## Features

### Skills (7 tools)

- **k8s-pod**: Pod management (list, describe, logs, restart, status)
- **k8s-deploy**: Deployment management (list, describe, scale, rollout status/history/restart/undo, update-image)
- **k8s-node**: Node management (list, describe, status, cordon, uncordon, drain, taints, labels)
- **k8s-svc**: Service management (list, describe, endpoints, status)
- **k8s-exec**: Container execution (exec, file_read, file_list, env, process_list, network_check)
- **k8s-logs**: Advanced log operations (search, multi_pod, since, compare, stats, export)
- **k8s-metrics**: Resource metrics and monitoring (pod_resources, node_resources, top_pods, top_nodes, namespace_usage, capacity_report)

### Planned Skills

- **k8s-events**: Event monitoring and anomaly detection

## Installation

1. Install dependencies:

```bash
cd /Users/a123/.openclaw/extensions/k8s
npm install
```

2. Enable the plugin in `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "k8s": {
        "enabled": true
      }
    }
  }
}
```

3. (Optional) Configure custom kubeconfig:

```json
{
  "plugins": {
    "entries": {
      "k8s": {
        "enabled": true,
        "kubeconfigPath": "/custom/path/to/kubeconfig",
        "defaultContext": "prod-cluster"
      }
    }
  }
}
```

## Usage

### List Pods

```
List all pods in the default namespace
```

Agent will use:
```json
{ "action": "list", "namespace": "default" }
```

### Get Pod Logs

```
Show me logs for nginx-deployment-abc123 in production namespace
```

Agent will use:
```json
{ "action": "logs", "namespace": "production", "pod_name": "nginx-deployment-abc123" }
```

### Troubleshoot Crashed Pod

```
The payment-service pod is crashing, help me debug it
```

Agent will:
1. Check pod status
2. Get previous logs (from crashed container)
3. Describe pod to see events

### Restart a Pod

```
Restart the frontend-app-xyz pod in staging
```

Agent will use:
```json
{ "action": "restart", "namespace": "staging", "pod_name": "frontend-app-xyz" }
```

### Execute Command in Container

```
Check what's in /etc/nginx on the nginx pod
```

Agent will use:
```json
{ "action": "exec", "namespace": "default", "pod_name": "nginx-abc123", "command": "ls -la /etc/nginx" }
```

### Search Logs

```
Search for errors in api-server logs
```

Agent will use:
```json
{ "action": "search", "namespace": "default", "pod_name": "api-server-xyz", "pattern": "ERROR|WARN", "tail_lines": 500 }
```

### Multi-Pod Log Aggregation

```
Show me logs from all api pods
```

Agent will use:
```json
{ "action": "multi_pod", "namespace": "production", "label_selector": "app=api-server", "tail_lines": 100 }
```

### Network Connectivity Check

```
Can the app pod reach redis?
```

Agent will use:
```json
{ "action": "network_check", "namespace": "default", "pod_name": "app-abc123", "target_host": "redis-service", "target_port": 6379 }
```

### Resource Metrics

```
Show me top pods by CPU usage in production
```

Agent will use:
```json
{ "action": "top_pods", "namespace": "production", "sort_by": "cpu", "top_n": 10 }
```

### Capacity Report

```
Give me a cluster capacity report
```

Agent will use:
```json
{ "action": "capacity_report" }
```

## Configuration in TOOLS.md

Add cluster-specific notes to `~/.openclaw/workspace/TOOLS.md`:

```markdown
### Kubernetes Clusters

- **prod-k8s-01** (192.168.1.100)
  - Context: prod-cluster
  - Critical services: order-service, payment-gateway
  - SLA: 99.99%

- **staging-k8s-01** (192.168.1.101)
  - Context: staging-cluster
  - For testing before production deployment

### Common Operations

- Restart order-service: namespace=production, label=app=order-service
- Check payment gateway: namespace=production, pod prefix=payment-gateway-
```

## Kubeconfig Setup

The plugin uses `~/.kube/config` by default. Ensure it's configured:

```bash
kubectl config get-contexts
kubectl config use-context <your-context>
```

## RBAC Permissions

Ensure your kubeconfig has appropriate RBAC permissions:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: openclaw-ops
  namespace: default
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec"]
    verbs: ["get", "list", "watch", "create"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["delete"]  # For restart action
  - apiGroups: [""]
    resources: ["pods/eviction"]
    verbs: ["create"]  # For node drain
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "patch", "update"]
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "patch"]
  - apiGroups: [""]
    resources: ["services", "endpoints"]
    verbs: ["get", "list"]
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list"]
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods", "nodes"]
    verbs: ["get", "list"]
```

## Development

Build the plugin:

```bash
npm run build
```

Run tests:

```bash
npm test
```

## Safety Notes

- The **restart** action deletes pods. Use with caution in production.
- Always verify namespace and pod name before destructive operations.
- Consider implementing approval workflows for production restarts.
- Audit all operations in `logs/k8s-ops.log` (TODO).

## Troubleshooting

### "Forbidden" Error

Check RBAC permissions in your kubeconfig. The service account needs appropriate roles.

### "Unable to connect to cluster"

Verify kubeconfig path and cluster accessibility:

```bash
kubectl cluster-info
```

### "No resources found"

Check if namespace exists:

```bash
kubectl get namespaces
```

## Future Enhancements

- [ ] Support for multiple kubeconfig files
- [ ] Interactive pod selection (fuzzy search)
- [ ] Log streaming (real-time tail)
- [x] Resource metrics integration (kubectl top)
- [ ] ConfigMap/Secret viewing
- [ ] Port forwarding
- [ ] Integration with Prometheus for metrics
- [ ] Alert integration (auto-respond to pod failures)

## Contributing

This plugin is part of your local OpenClaw installation. Customize it as needed for your infrastructure.
