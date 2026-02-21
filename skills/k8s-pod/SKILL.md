---
name: k8s-pod
description: |
  Kubernetes Pod operations. Activate when user mentions pods, containers, k8s workloads, or pod troubleshooting.
---

# Kubernetes Pod Tool

Single tool `k8s_pod` with action parameter for all pod operations.

## Configuration

Uses kubeconfig from `~/.kube/config` by default. Configure in `config.yaml`:

```yaml
plugins:
  entries:
    k8s:
      enabled: true
      kubeconfigPath: "/custom/path/to/kubeconfig"  # optional
      defaultContext: "prod-cluster"                 # optional
```

Also configure in `TOOLS.md` for cluster-specific notes.

## Actions

### List Pods

List all pods in a namespace:

```json
{
  "action": "list",
  "namespace": "default"
}
```

List pods across all namespaces:

```json
{
  "action": "list",
  "all_namespaces": true
}
```

Filter by label selector:

```json
{
  "action": "list",
  "namespace": "production",
  "label_selector": "app=nginx"
}
```

Returns: Pod names, status, restarts, age, and node placement.

### Describe Pod

Get detailed information about a specific pod:

```json
{
  "action": "describe",
  "namespace": "default",
  "pod_name": "nginx-deployment-123abc"
}
```

Returns: Full pod details including conditions, events, resource usage, and container states.

### Get Pod Logs

Fetch logs from a pod:

```json
{
  "action": "logs",
  "namespace": "default",
  "pod_name": "nginx-deployment-123abc"
}
```

With container name (for multi-container pods):

```json
{
  "action": "logs",
  "namespace": "default",
  "pod_name": "nginx-deployment-123abc",
  "container": "nginx"
}
```

Get previous container logs (useful for crashed pods):

```json
{
  "action": "logs",
  "namespace": "default",
  "pod_name": "nginx-deployment-123abc",
  "previous": true
}
```

Tail logs (last N lines):

```json
{
  "action": "logs",
  "namespace": "default",
  "pod_name": "nginx-deployment-123abc",
  "tail_lines": 100
}
```

### Restart Pod

Delete a pod to trigger restart (works for Deployments, StatefulSets, etc.):

```json
{
  "action": "restart",
  "namespace": "default",
  "pod_name": "nginx-deployment-123abc"
}
```

**Note:** This deletes the pod. The controller (Deployment/StatefulSet) will automatically recreate it.

### Get Pod Status

Quick status check for a pod:

```json
{
  "action": "status",
  "namespace": "default",
  "pod_name": "nginx-deployment-123abc"
}
```

Returns: Phase, conditions, restart count, and ready status.

## Common Workflows

### Troubleshooting CrashLoopBackOff

1. Check pod status:
   ```json
   { "action": "status", "namespace": "production", "pod_name": "app-pod" }
   ```

2. Get previous logs (from crashed container):
   ```json
   { "action": "logs", "namespace": "production", "pod_name": "app-pod", "previous": true }
   ```

3. Describe pod for events:
   ```json
   { "action": "describe", "namespace": "production", "pod_name": "app-pod" }
   ```

### Finding Pods by Label

```json
{ "action": "list", "namespace": "production", "label_selector": "app=frontend,tier=web" }
```

### Multi-Cluster Operations

Switch context before operations (configure in `TOOLS.md`):

```markdown
### K8s Clusters

- prod-cluster → Production environment (kubectl config use-context prod-cluster)
- staging-cluster → Staging environment (kubectl config use-context staging-cluster)
```

## Permissions Required

The kubeconfig must have the following RBAC permissions:

- `pods/list` - List pods
- `pods/get` - Get pod details
- `pods/log` - Read pod logs
- `pods/delete` - Restart pods (optional, can be restricted)

## Safety Notes

- **Restart action** deletes pods - use with caution in production
- Always verify namespace and pod name before restart
- For stateful workloads, ensure the restart is safe
- Consider using `kubectl rollout restart deployment/<name>` for controlled restarts

## Error Handling

Common errors and solutions:

- **"Forbidden"**: Check RBAC permissions in kubeconfig
- **"Not Found"**: Verify namespace and pod name
- **"No resources found"**: Check namespace exists and has pods
- **"Multiple containers"**: Specify container name for logs action
