# OpenClaw Kubernetes Plugin

Kubernetes operations plugin for OpenClaw, providing tools to manage K8s resources.

## Features

### Current Skills

- **k8s-pod**: Pod management (list, describe, logs, restart, status)
- **k8s-deploy**: Deployment management (list, describe, scale, rollout status/history/restart/undo, update-image)

### Planned Skills

- **k8s-logs**: Advanced log queries and aggregation
- **k8s-metrics**: Resource metrics and monitoring
- **k8s-events**: Event monitoring and anomaly detection
- **k8s-node**: Node management and health checks
- **k8s-svc**: Service and Ingress management

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
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["delete"]  # For restart action
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list"]
```

## Development

Build the plugin:

```bash
npm run build
```

Run tests (when implemented):

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
- [ ] Resource metrics integration (kubectl top)
- [ ] Deployment rollout management
- [ ] ConfigMap/Secret viewing
- [ ] Exec into containers
- [ ] Port forwarding
- [ ] Integration with Prometheus for metrics
- [ ] Alert integration (auto-respond to pod failures)

## Contributing

This plugin is part of your local OpenClaw installation. Customize it as needed for your infrastructure.
