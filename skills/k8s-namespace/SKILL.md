---
name: k8s-namespace
description: |
  Kubernetes namespace operations. Activate when user mentions namespaces, quota, limits, resource management, or needs to manage multi-tenant environments.
---

# Kubernetes Namespace Tool

Single tool `k8s_namespace` with action parameter for namespace operations.

## Actions

### List Namespaces

List all namespaces:

```json
{
  "action": "list"
}
```

Filter by label:

```json
{
  "action": "list",
  "label_selector": "environment=production"
}
```

Returns: Namespace names, status, age, labels.

### Describe Namespace

Get detailed information about a namespace:

```json
{
  "action": "describe",
  "namespace": "production"
}
```

Returns: Full namespace details including labels, annotations, and resource counts.

### Get Resource Quota

Get resource quota for a namespace:

```json
{
  "action": "quota",
  "namespace": "production"
}
```

Returns: Hard limits and current usage for CPU, memory, pods, etc.

### Get Limit Range

Get limit ranges (default/required limits):

```json
{
  "action": "limits",
  "namespace": "production"
}
```

Returns: Default and required values for CPU, memory per container.

### Get Namespace Summary

Get resource summary for a namespace:

```json
{
  "action": "summary",
  "namespace": "production"
}
```

Returns: Pod count, service count, deployment count, PVC count, etc.

### Create Namespace

Create a new namespace:

```json
{
  "action": "create",
  "namespace": "new-project",
  "labels": {
    "environment": "development",
    "team": "platform"
  }
}
```

### Update Namespace Labels

Add or update labels:

```json
{
  "action": "label",
  "namespace": "production",
  "labels": {
    "criticality": "high",
    "cost-center": "engineering"
  }
}
```

### Delete Namespace

Delete a namespace:

```json
{
  "action": "delete",
  "namespace": "old-project"
}
```

**Warning**: Deleting a namespace deletes ALL resources within it!

### Set Resource Quota

Set or update resource quota:

```json
{
  "action": "set_quota",
  "namespace": "production",
  "hard": {
    "limits.cpu": "100",
    "limits.memory": "200Gi",
    "pods": "50",
    "services": "20",
    "persistentvolumeclaims": "10"
  }
}
```

## Common Workflows

### Check Namespace Health

1. List namespaces:
   ```json
   { "action": "list" }
   ```

2. Describe namespace:
   ```json
   { "action": "describe", "namespace": "production" }
   ```

3. Get summary:
   ```json
   { "action": "summary", "namespace": "production" }
   ```

### Check Quota Usage

1. Get quota:
   ```json
   { "action": "quota", "namespace": "production" }
   ```

2. Get current usage:
   ```json
   { "action": "describe", "namespace": "production" }
   ```

### Create New Environment

1. Create namespace:
   ```json
   { "action": "create", "namespace": "staging", "labels": {"environment": "staging"} }
   ```

2. Set quota:
   ```json
   { "action": "set_quota", "namespace": "staging", "hard": {"pods": "100", "limits.cpu": "50"} }
   ```

### Find Resource-Heavy Namespace

1. List all:
   ```json
   { "action": "list" }
   ```

2. Get summary for each:
   ```json
   { "action": "summary", "namespace": "production" }
   ```

## Namespace States

- **Active** - Normal operation
- **Terminating** - Being deleted (resources still present)

## Quota vs Limits

- **ResourceQuota**: Cluster-wide limits per namespace
- **LimitRange**: Default/required values for pods/containers within namespace

## Safety Notes

- **Delete operations** are irreversible - ALL resources in namespace will be deleted
- **Quotas** prevent resource exhaustion but may break deployments if too low
- Always verify namespace before destructive operations
- Use labels for organization and filtering

## Permissions Required

The kubeconfig must have the following RBAC permissions:

- `namespaces/list` - List namespaces
- `namespaces/get` - Get namespace details
- `namespaces/update` - Update labels
- `namespaces/create` - Create namespace
- `namespaces/delete` - Delete namespace
- `resourcequotas/get` - Get quota info
- `resourcequotas/create` - Create quota
- `limitranges/get` - Get limit ranges

## Error Handling

Common errors and solutions:

- **"AlreadyExists"**: Namespace name already in use
- **"NotFound"**: Namespace doesn't exist
- **"Forbidden"**: Check RBAC permissions
- **"Terminating"**: Namespace stuck in terminating state - check finalizers
- **"QuotaExceeded"**: Resource quota exceeded - need to increase quota

## Examples

### Daily Operations

"List all namespaces"
"What's the status of production namespace"
"Show me resource quotas for staging"

### Troubleshooting

"Why can't I create more pods in production?"
Agent will:
1. Get quota for production
2. Check current pod count
3. Suggest quota increase or cleanup

"Show me what's in each namespace"
Agent will:
1. Get summary for each namespace
2. Provide breakdown of resources

### Management

"Create a new namespace for the new team"
"Add a label to production namespace"
"Set CPU quota to 100 cores for ml-team namespace"