---
name: k8s-svc
description: |
  Kubernetes Service operations. Activate when user mentions services, endpoints, load balancing, or service discovery.
---

# Kubernetes Service Tool

Single tool `k8s_svc` with action parameter for all service operations.

## Actions

### List Services

List all services in a namespace:

```json
{
  "action": "list",
  "namespace": "default"
}
```

List services across all namespaces:

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

Returns: Service names, type, cluster-IP, external-IP, ports, and age.

### Describe Service

Get detailed information about a service:

```json
{
  "action": "describe",
  "namespace": "default",
  "service_name": "nginx-service"
}
```

Returns: Full service details including selector, endpoints, session affinity, and events.

### Get Endpoints

View the endpoints backing a service:

```json
{
  "action": "endpoints",
  "namespace": "default",
  "service_name": "nginx-service"
}
```

Returns: List of pod IP addresses and ports that the service routes to.

**Use case**: Verify that service has healthy endpoints, troubleshoot service connectivity.

### Get Service Status

Quick status check for a service:

```json
{
  "action": "status",
  "namespace": "default",
  "service_name": "nginx-service"
}
```

Returns: Service type, cluster IP, external IP (if any), and endpoint count.

## Service Types

### ClusterIP
- **Default type**
- Exposes service on cluster-internal IP
- Service only reachable from within the cluster

### NodePort
- Exposes service on each node's IP at a static port
- Accessible from outside cluster via `<NodeIP>:<NodePort>`
- Port range: 30000-32767 (default)

### LoadBalancer
- Exposes service externally using cloud provider's load balancer
- Automatically creates NodePort and ClusterIP services

### ExternalName
- Maps service to a DNS name
- No proxying, just DNS resolution

## Common Workflows

### Verify Service Configuration

1. List services in namespace:
   ```json
   { "action": "list", "namespace": "production" }
   ```

2. Describe specific service:
   ```json
   { "action": "describe", "namespace": "production", "service_name": "api-server" }
   ```

3. Check endpoints:
   ```json
   { "action": "endpoints", "namespace": "production", "service_name": "api-server" }
   ```

### Troubleshoot Service Connectivity

**Scenario**: Application cannot reach service

1. **Check service exists**:
   ```json
   { "action": "list", "namespace": "production" }
   ```

2. **Verify endpoints**:
   ```json
   { "action": "endpoints", "namespace": "production", "service_name": "api-server" }
   ```

   - If no endpoints → Check if pods are running and match selector
   - If endpoints exist but unreachable → Check pod health

3. **Describe service for selector**:
   ```json
   { "action": "describe", "namespace": "production", "service_name": "api-server" }
   ```

### Verify Load Balancing

For a service with multiple pods:

1. Get service details:
   ```json
   { "action": "status", "namespace": "production", "service_name": "frontend" }
   ```

2. Check endpoints (should show multiple pod IPs):
   ```json
   { "action": "endpoints", "namespace": "production", "service_name": "frontend" }
   ```

## Permissions Required

The kubeconfig must have the following RBAC permissions:

- `services/list` - List services
- `services/get` - Get service details
- `endpoints/list` - List endpoints
- `endpoints/get` - Get endpoint details
- `events/list` - View service events

## Error Handling

Common errors and solutions:

- **"Service has no endpoints"**: No pods match the service selector
  - Check pod labels match service selector
  - Verify pods are running and ready

- **"Service not found"**: Verify namespace and service name

- **"Endpoints not found"**: Service may not have created endpoints yet
  - Wait for pods to be ready
  - Check if selector matches any pods

## Examples

### Daily Operations

"List all services in production namespace"
"What's the cluster IP of the api-server service?"
"Show me the endpoints for the nginx service"

### Troubleshooting

"Why can't I reach the payment-service?"
Agent will:
1. Check if service exists
2. Verify service has endpoints
3. Check if endpoints are healthy
4. Suggest remediation

"The frontend service has no endpoints, what's wrong?"
Agent will:
1. Get service selector
2. List pods matching selector
3. Check if pods are Ready
4. Identify mismatch or pod issues

### Service Discovery

"What services are available in the production namespace?"
"Which pods is the order-service routing to?"
"Is the load balancer service getting an external IP?"
