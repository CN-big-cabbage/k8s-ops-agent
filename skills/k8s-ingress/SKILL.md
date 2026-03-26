---
name: k8s-ingress
description: |
  Kubernetes Ingress management. Activate when user mentions ingress, routes, HTTP routing, load balancing rules, or needs to manage external access to services.
---

# Kubernetes Ingress Tool

Single tool `k8s_ingress` with action parameter for Ingress operations.

## Actions

### List Ingresses

List all Ingresses in a namespace:

```json
{
  "action": "list",
  "namespace": "default"
}
```

List across all namespaces:

```json
{
  "action": "list",
  "all_namespaces": true
}
```

Filter by label:

```json
{
  "action": "list",
  "namespace": "production",
  "label_selector": "app=api"
}
```

Returns: Ingress names, hosts, paths, services, ports, age.

### Describe Ingress

Get detailed information about an Ingress:

```json
{
  "action": "describe",
  "namespace": "default",
  "ingress_name": "api-ingress"
}
```

Returns: Full Ingress details including TLS config, annotations, rules, and backend services.

### Get Ingress Rules

Get parsed routing rules:

```json
{
  "action": "rules",
  "namespace": "default",
  "ingress_name": "api-ingress"
}
```

Returns: Host → Path → Service mapping with ports.

### Get TLS Configuration

Get TLS/SSL configuration:

```json
{
  "action": "tls",
  "namespace": "default",
  "ingress_name": "api-ingress"
}
```

Returns: TLS hosts, secret names, certificate info.

### Get Annotations

Get Ingress annotations:

```json
{
  "action": "annotations",
  "namespace": "default",
  "ingress_name": "api-ingress"
}
```

Returns: All annotations including nginx ingress, ALB, GCLB, etc.

### Update Ingress (Create if Not Exists)

Add or update ingress rules:

```json
{
  "action": "update",
  "namespace": "default",
  "ingress_name": "api-ingress",
  "rules": [
    {
      "host": "api.example.com",
      "paths": [
        {
          "path": "/v1",
          "service": "api-service",
          "service_port": 8080
        },
        {
          "path": "/v2",
          "service": "api-v2-service",
          "service_port": 8080
        }
      ]
    }
  ]
}
```

Add TLS:

```json
{
  "action": "update",
  "namespace": "default",
  "ingress_name": "api-ingress",
  "tls": [
    {
      "hosts": ["api.example.com"],
      "secret_name": "api-tls-secret"
    }
  ]
}
```

### Add Annotation

Add or update an annotation:

```json
{
  "action": "add_annotation",
  "namespace": "default",
  "ingress_name": "api-ingress",
  "annotation": "nginx.ingress.kubernetes.io/rate-limit",
  "value": "100"
}
```

### Delete Ingress

Delete an Ingress:

```json
{
  "action": "delete",
  "namespace": "default",
  "ingress_name": "old-ingress"
}
```

### Check Ingress Health

Check if ingress endpoints are reachable:

```json
{
  "action": "health",
  "namespace": "default",
  "ingress_name": "api-ingress"
}
```

## Common Workflows

### Troubleshoot 404 Errors

1. List ingresses:
   ```json
   { "action": "list", "namespace": "production" }
   ```

2. Describe the ingress:
   ```json
   { "action": "describe", "namespace": "production", "ingress_name": "api-ingress" }
   ```

3. Check rules:
   ```json
   { "action": "rules", "namespace": "production", "ingress_name": "api-ingress" }
   ```

4. Verify service exists and has endpoints:
   Use k8s-svc to check service endpoints

### Add New Route

1. Get current rules:
   ```json
   { "action": "rules", "namespace": "production", "ingress_name": "api-ingress" }
   ```

2. Update with new path:
   ```json
   { "action": "update", "namespace": "production", "ingress_name": "api-ingress", "rules": [...] }
   ```

### Enable TLS

1. Check current TLS status:
   ```json
   { "action": "tls", "namespace": "production", "ingress_name": "api-ingress" }
   ```

2. Create TLS secret:
   Use k8s-config to create secret with certificate

3. Update ingress:
   ```json
   { "action": "update", "namespace": "production", "ingress_name": "api-ingress", "tls": [...] }
   ```

### Compare Routes

Compare ingress configurations across environments:

1. Get staging ingress rules:
   ```json
   { "action": "rules", "namespace": "staging", "ingress_name": "api-ingress" }
   ```

2. Get production ingress rules:
   ```json
   { "action": "rules", "namespace": "production", "ingress_name": "api-ingress" }
   ```

## Ingress Controllers

This tool works with common Ingress controllers:

- **NGINX Ingress Controller** - Most common
- **AWS ALB Ingress Controller**
- **GCE Ingress Controller**
- **Traefik**
- **Kong**
- **Azure Application Gateway**

Annotations are passed through to the specific controller.

## Safety Notes

- **Delete operations** are irreversible - traffic will stop immediately
- **Updates** may cause brief traffic interruption
- Some annotations require specific controller configuration
- TLS updates need valid certificates

## Permissions Required

The kubeconfig must have the following RBAC permissions:

- `ingresses/list` - List Ingresses
- `ingresses/get` - Get Ingress details
- `ingresses/update` - Update Ingress
- `ingresses/create` - Create Ingress
- `ingresses/delete` - Delete Ingress
- `services/get` - Check backend services (optional)

## Error Handling

Common errors and solutions:

- **"Not Found"**: Verify namespace and ingress name
- **"Forbidden"**: Check RBAC permissions
- **"Invalid rule"**: Check path format and service name
- **"Service not found"**: Backend service must exist
- **"Annotation error"**: Check controller-specific annotation format

## Examples

### Daily Operations

"List all ingresses in production"
"Show me the api-ingress rules"
"What's the TLS config for the web-ingress"

### Troubleshooting

"Why am I getting 404 from my ingress?"
Agent will:
1. Describe the ingress
2. Check rules and paths
3. Verify backend service exists
4. Suggest fixes

"The new route isn't working"
Agent will:
1. Check if ingress was updated
2. Verify path and service mapping
3. Check service endpoints
4. Suggest remediation

### Configuration

"Add a new path /webhooks to the api ingress"
"Enable TLS on the web ingress"
"Add rate limiting annotation to the ingress"