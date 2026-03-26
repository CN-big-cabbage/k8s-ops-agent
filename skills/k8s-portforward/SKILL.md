---
name: k8s-portforward
description: |
  Kubernetes port forwarding for pod debugging. Activate when user needs to access a pod's port locally, test internal services, or debug applications that aren't exposed externally.
---

# Kubernetes Port Forward Tool

Single tool `k8s_portforward` with action parameter for port forwarding operations.

## Actions

### Create Port Forward

Create a port forward to a pod:

```json
{
  "action": "create",
  "namespace": "default",
  "pod_name": "nginx-abc123",
  "local_port": 8080,
  "pod_port": 80
}
```

With custom local port (auto-select if omitted):

```json
{
  "action": "create",
  "namespace": "production",
  "pod_name": "redis-abc123",
  "pod_port": 6379
}
```

Port forward to a Service (creates temporary pod):

```json
{
  "action": "create_service_forward",
  "namespace": "production",
  "service_name": "nginx-service",
  "local_port": 8080,
  "target_port": 80
}
```

### List Active Port Forwards

List all active port forwards:

```json
{
  "action": "list"
}
```

### Close Port Forward

Close an active port forward:

```json
{
  "action": "close",
  "local_port": 8080
}
```

Close by pod name:

```json
{
  "action": "close_pod",
  "namespace": "default",
  "pod_name": "nginx-abc123"
}
```

Close all port forwards:

```json
{
  "action": "close_all"
}
```

### Test Port

Test if a local port is accessible:

```json
{
  "action": "test",
  "local_port": 8080
}
```

## Common Workflows

### Debug Internal API

1. Create port forward to API pod:
   ```json
   { "action": "create", "namespace": "production", "pod_name": "api-abc123", "local_port": 8080, "pod_port": 8080 }
   ```

2. Test locally:
   ```json
   { "action": "test", "local_port": 8080 }
   ```

3. Make requests: `curl http://localhost:8080/health`

4. Close when done:
   ```json
   { "action": "close", "local_port": 8080 }
   ```

### Access Database Directly

1. Forward to database pod:
   ```json
   { "action": "create", "namespace": "production", "pod_name": "postgres-abc123", "local_port": 5432, "pod_port": 5432 }
   ```

2. Connect: `psql -h localhost -p 5432 -U postgres`

### Test Redis Cache

1. Forward to Redis:
   ```json
   { "action": "create", "namespace": "production", "pod_name": "redis-abc123", "local_port": 6379 }
   ```

2. Use redis-cli: `redis-cli -p 6379`

### Access Non-Exposed Service

1. Find the service endpoint pod:
   ```json
   { "action": "list", "namespace": "production", "label_selector": "app=internal-service" }
   ```

2. Create port forward:
   ```json
   { "action": "create", "namespace": "production", "pod_name": "internal-service-xyz", "local_port": 9000, "pod_port": 8080 }
   ```

## Implementation Notes

Port forwarding uses `kubectl port-forward` command which:
- Creates a tunnel between local port and pod port
- Requires the pod to be running
- Stops when the connection is closed or pod terminates
- Supports TCP only (not UDP)

For Services, the tool may need to:
1. Create a temporary pod with appropriate tooling (e.g., kubectl run)
2. Forward through that pod to the service

## Safety Notes

- Port forwards are temporary - they don't survive pod restarts
- Only one forward per local port allowed
- Close port forwards when done to free up local ports
- Don't expose sensitive services to untrusted networks
- Some pods may not have necessary tools (curl, redis-cli, etc.)

## Permissions Required

The kubeconfig must have the following RBAC permissions:

- `pods/portforward` - Create port forward
- `pods/exec` - May be needed for service forwarding
- `services/get` - For service forwarding

## Error Handling

Common errors and solutions:

- **"Address already in use"**: Local port is in use, try different port
- **"Pod not found"**: Verify pod name and namespace
- **"Pod not running"**: Pod must be in Running state
- **"Unable to forward"**: Check if kubectl port-forward is available
- **"Connection refused"**: Pod port may be wrong or service not listening

## Examples

### Quick Access

"Forward port 8080 on the api pod in production"
"Open redis so I can test it locally"
"Create a tunnel to the postgres database pod"

### Debugging

"I need to check the internal metrics endpoint on the app"
"My service isn't exposed externally, help me test it"
"Connect me to the cache so I can check keys"

### Cleanup

"Show me all active port forwards"
"Close the database port forward"
"Clean up all port forwards"