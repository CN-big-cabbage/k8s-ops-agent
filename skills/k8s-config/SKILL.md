---
name: k8s-config
description: |
  Kubernetes ConfigMap and Secret operations. Activate when user mentions configmaps, secrets, configuration, or needs to view/edit configuration data in Kubernetes.
---

# Kubernetes ConfigMap/Secret Tool

Single tool `k8s_config` with action parameter for ConfigMap and Secret operations.

## Configuration

Uses kubeconfig from `~/.kube/config` by default.

## Actions

### List ConfigMaps

List all ConfigMaps in a namespace:

```json
{
  "action": "list_cm",
  "namespace": "default"
}
```

List secrets:

```json
{
  "action": "list_secret",
  "namespace": "default"
}
```

List both:

```json
{
  "action": "list_all",
  "namespace": "default"
}
```

Filter by label:

```json
{
  "action": "list_cm",
  "namespace": "production",
  "label_selector": "app=nginx"
}
```

Returns: Names, type, data keys, age.

### Describe ConfigMap

Get detailed information about a ConfigMap:

```json
{
  "action": "describe_cm",
  "namespace": "default",
  "configmap_name": "nginx-config"
}
```

Describe Secret:

```json
{
  "action": "describe_secret",
  "namespace": "default",
  "secret_name": "db-credentials"
}
```

Returns: Full ConfigMap/Secret details including data, binary data, and metadata.

### Get ConfigMap Data

Get raw data from a ConfigMap:

```json
{
  "action": "get_cm_data",
  "namespace": "default",
  "configmap_name": "nginx-config",
  "key": "nginx.conf"
}
```

Get all data as formatted output:

```json
{
  "action": "get_cm_data",
  "namespace": "default",
  "configmap_name": "nginx-config"
}
```

### Get Secret Data

Get decoded data from a Secret:

```json
{
  "action": "get_secret_data",
  "namespace": "default",
  "secret_name": "db-credentials"
}
```

Get specific key:

```json
{
  "action": "get_secret_data",
  "namespace": "default",
  "secret_name": "db-credentials",
  "key": "password"
}
```

**Note**: Secret data is automatically base64-decoded for easy reading.

### List Keys

List all keys in a ConfigMap or Secret:

```json
{
  "action": "list_keys",
  "namespace": "default",
  "configmap_name": "nginx-config"
}
```

```json
{
  "action": "list_keys",
  "namespace": "default",
  "secret_name": "db-credentials"
}
```

### Update ConfigMap (Create if Not Exists)

Update data in an existing ConfigMap:

```json
{
  "action": "update_cm",
  "namespace": "default",
  "configmap_name": "nginx-config",
  "data": {
    "nginx.conf": "server { ... }",
    "app.properties": "debug=true"
  }
}
```

### Create Secret

Create a new Secret:

```json
{
  "action": "create_secret",
  "namespace": "default",
  "secret_name": "api-keys",
  "secret_type": "Opaque",
  "data": {
    "api_key": "your-api-key",
    "api_secret": "your-secret"
  }
}
```

Secret types: Opaque, kubernetes.io/dockerconfigjson, kubernetes.io/tls, kubernetes.io/ssh-auth

### Delete ConfigMap/Secret

Delete a ConfigMap:

```json
{
  "action": "delete_cm",
  "namespace": "default",
  "configmap_name": "old-config"
}
```

Delete a Secret:

```json
{
  "action": "delete_secret",
  "namespace": "default",
  "secret_name": "old-secret"
}
```

**Warning**: Deleting ConfigMaps/Secrets may break running applications. Use with caution!

## Common Workflows

### View Application Configuration

1. List ConfigMaps in namespace:
   ```json
   { "action": "list_cm", "namespace": "production" }
   ```

2. Get specific ConfigMap:
   ```json
   { "action": "describe_cm", "namespace": "production", "configmap_name": "app-config" }
   ```

3. Get specific key:
   ```json
   { "action": "get_cm_data", "namespace": "production", "configmap_name": "app-config", "key": "app.properties" }
   ```

### Check Database Credentials

1. Describe secret:
   ```json
   { "action": "describe_secret", "namespace": "production", "secret_name": "db-credentials" }
   ```

2. Get decoded password:
   ```json
   { "action": "get_secret_data", "namespace": "production", "secret_name": "db-credentials", "key": "password" }
   ```

### Find Which Pod Uses a ConfigMap

1. List pods and check envFrom/volumes in describe:
   ```json
   { "action": "list", "namespace": "production", "label_selector": "app=myapp" }
   ```
   Then use k8s-pod describe to check volumeMounts and envFrom.

### Compare ConfigMaps Across Environments

1. Get config from staging:
   ```json
   { "action": "get_cm_data", "namespace": "staging", "configmap_name": "app-config" }
   ```

2. Get config from production:
   ```json
   { "action": "get_cm_data", "namespace": "production", "configmap_name": "app-config" }
   ```

## Safety Notes

- **Delete operations** are irreversible - always confirm before deletion
- **Secret values** are base64-encoded in Kubernetes - tool automatically decodes
- **Update operations** will trigger pod restarts if the ConfigMap/Secret is mounted as volume
- Be careful updating secrets in production - may cause downtime

## Permissions Required

The kubeconfig must have the following RBAC permissions:

- `configmaps/list` - List ConfigMaps
- `configmaps/get` - Get ConfigMap details and data
- `configmaps/update` - Update ConfigMaps (optional)
- `configmaps/create` - Create ConfigMaps (optional)
- `configmaps/delete` - Delete ConfigMaps (optional)
- `secrets/list` - List Secrets
- `secrets/get` - Get Secret details and data
- `secrets/update` - Update Secrets (optional)
- `secrets/create` - Create Secrets (optional)
- `secrets/delete` - Delete Secrets (optional)

## Error Handling

Common errors and solutions:

- **"Not Found"**: Verify namespace and ConfigMap/Secret name
- **"Forbidden"**: Check RBAC permissions
- **"Invalid data"**: For secrets, ensure data is properly base64 encoded (or let the tool encode it)
- **"ConfigMap in use"**: Some pods may depend on this ConfigMap

## Examples

### Daily Operations

"List all ConfigMaps in production"
"What's in the nginx-config ConfigMap?"
"Show me the db-credentials secret"

### Troubleshooting

"Why is my app using old config?"
Agent will:
1. Get the ConfigMap current data
2. Check if pod has mounted the latest version
3. Suggest pod restart if needed

"My app can't connect to the database, check the credentials"
Agent will:
1. Describe the db-credentials secret
2. Get decoded username/password
3. Verify values are correct

### Configuration Management

"Update the app-config ConfigMap with new settings"
"Create a new secret for API keys"