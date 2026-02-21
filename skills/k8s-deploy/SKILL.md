---
name: k8s-deploy
description: |
  Kubernetes Deployment operations. Activate when user mentions deployments, rollouts, scaling, or application updates.
---

# Kubernetes Deployment Tool

Single tool `k8s_deploy` with action parameter for all deployment operations.

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

## Actions

### List Deployments

List all deployments in a namespace:

```json
{
  "action": "list",
  "namespace": "default"
}
```

List deployments across all namespaces:

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

Returns: Deployment names, ready replicas, up-to-date replicas, available replicas, and age.

### Describe Deployment

Get detailed information about a deployment:

```json
{
  "action": "describe",
  "namespace": "default",
  "deployment_name": "nginx-deployment"
}
```

Returns: Full deployment details including strategy, replicas, selector, template, conditions, and recent events.

### Scale Deployment

Change the number of replicas:

```json
{
  "action": "scale",
  "namespace": "default",
  "deployment_name": "nginx-deployment",
  "replicas": 5
}
```

Returns: Confirmation of scaling operation.

### Rollout Status

Check the status of a deployment rollout:

```json
{
  "action": "rollout_status",
  "namespace": "default",
  "deployment_name": "nginx-deployment"
}
```

Returns: Current rollout status, updated/ready replicas, and conditions.

### Rollout History

View the rollout history of a deployment:

```json
{
  "action": "rollout_history",
  "namespace": "default",
  "deployment_name": "nginx-deployment"
}
```

With specific revision:

```json
{
  "action": "rollout_history",
  "namespace": "default",
  "deployment_name": "nginx-deployment",
  "revision": 3
}
```

Returns: List of revisions with change-cause annotations.

### Rollout Restart

Restart a deployment (triggers new rollout with same spec):

```json
{
  "action": "rollout_restart",
  "namespace": "default",
  "deployment_name": "nginx-deployment"
}
```

Returns: Confirmation of restart initiation.

### Rollout Undo

Rollback to a previous revision:

```json
{
  "action": "rollout_undo",
  "namespace": "default",
  "deployment_name": "nginx-deployment"
}
```

Rollback to specific revision:

```json
{
  "action": "rollout_undo",
  "namespace": "default",
  "deployment_name": "nginx-deployment",
  "to_revision": 3
}
```

Returns: Confirmation of rollback operation.

### Update Image

Update container image in a deployment:

```json
{
  "action": "update_image",
  "namespace": "default",
  "deployment_name": "nginx-deployment",
  "container": "nginx",
  "image": "nginx:1.21"
}
```

Returns: Confirmation of image update.

## Common Workflows

### Deploy New Version

1. Update image:
   ```json
   { "action": "update_image", "namespace": "production", "deployment_name": "api-server", "container": "api", "image": "api:v2.0" }
   ```

2. Monitor rollout:
   ```json
   { "action": "rollout_status", "namespace": "production", "deployment_name": "api-server" }
   ```

3. If issues occur, rollback:
   ```json
   { "action": "rollout_undo", "namespace": "production", "deployment_name": "api-server" }
   ```

### Scale for Traffic Spike

```json
{ "action": "scale", "namespace": "production", "deployment_name": "frontend", "replicas": 10 }
```

Monitor status:
```json
{ "action": "describe", "namespace": "production", "deployment_name": "frontend" }
```

### Emergency Restart

When pods are misbehaving but not crashing:

```json
{ "action": "rollout_restart", "namespace": "production", "deployment_name": "payment-service" }
```

### Investigate Failed Rollout

1. Check rollout status:
   ```json
   { "action": "rollout_status", "namespace": "production", "deployment_name": "order-service" }
   ```

2. View history to see what changed:
   ```json
   { "action": "rollout_history", "namespace": "production", "deployment_name": "order-service" }
   ```

3. Check current deployment details:
   ```json
   { "action": "describe", "namespace": "production", "deployment_name": "order-service" }
   ```

## Deployment Strategies

The tool respects the deployment's configured strategy:

- **RollingUpdate** (default): Gradual replacement of old pods with new ones
  - `maxUnavailable`: Max number/percentage of pods that can be unavailable
  - `maxSurge`: Max number/percentage of pods that can be created above desired

- **Recreate**: All old pods are killed before new ones are created (causes downtime)

## Safety Notes

- **Scale operations** affect availability - ensure you don't scale to 0 in production
- **Rollout undo** immediately triggers a new rollout - pods will restart
- **Update image** triggers a rolling update - monitor the rollout status
- **Rollout restart** recreates all pods - may cause temporary service disruption
- Always verify namespace and deployment name before destructive operations
- For critical services, ensure health checks are configured before rollouts

## Best Practices

### Before Scaling Down

1. Check current load/traffic
2. Ensure replicas won't drop below minimum for availability
3. Consider autoscaling policies

### Before Rollout Undo

1. Check rollout history to understand what you're rolling back to
2. Verify the target revision is stable
3. Have a plan to fix the root cause

### After Image Update

1. Monitor rollout status until complete
2. Check pod logs for errors
3. Verify application health endpoints
4. Monitor metrics for anomalies

## Change Annotations

Add change-cause annotations when updating deployments:

```bash
kubectl annotate deployment/nginx-deployment kubernetes.io/change-cause="Update to nginx 1.21 for security patch"
```

This appears in rollout history for better tracking.

## Permissions Required

The kubeconfig must have the following RBAC permissions:

- `deployments/list` - List deployments
- `deployments/get` - Get deployment details
- `deployments/update` - Scale and update deployments
- `deployments/patch` - Update specific fields
- `replicasets/list` - View rollout history
- `replicasets/get` - Get replica set details
- `events/list` - View deployment events

## Integration with Other Tools

### Combined with k8s-pod

After deployment operations, check pod status:

1. Scale deployment → List pods to verify new replicas
2. Update image → Check pod logs for errors
3. Rollout undo → Describe pods to ensure they're healthy

### Monitoring Integration

After critical operations, check metrics:

```
After scaling frontend to 10 replicas, check Prometheus metrics for CPU/memory
```

## Error Handling

Common errors and solutions:

- **"Forbidden"**: Check RBAC permissions
- **"Not Found"**: Verify namespace and deployment name
- **"Invalid replicas"**: Replicas must be >= 0
- **"Rollout stuck"**: Check pod events, may need manual intervention
- **"No revision found"**: Specified revision doesn't exist in history

## Examples

### Daily Operations

"Scale the api-server deployment in production to 5 replicas"
"What's the rollout status of the frontend deployment?"
"Restart the payment-service deployment to clear memory leaks"

### Deployment Updates

"Update the nginx container in web-app deployment to nginx:1.21"
"Roll back the order-service deployment to the previous version"
"Show me the rollout history for payment-gateway"

### Troubleshooting

"The checkout-service deployment isn't rolling out, what's wrong?"
Agent will:
1. Check rollout status
2. Describe deployment for conditions
3. List pods to see current state
4. Check recent events
5. Suggest remediation

### Multi-Step Operations

"Deploy api-server v2.0 to production and monitor it"
Agent will:
1. Update image to v2.0
2. Monitor rollout status
3. Check pod health
4. Report completion or issues
5. Suggest rollback if problems detected
