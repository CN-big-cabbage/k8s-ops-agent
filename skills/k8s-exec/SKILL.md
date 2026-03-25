---
name: k8s-exec
description: |
  Kubernetes container execution. Activate when user wants to run commands inside containers, check files, view processes, or test network connectivity in pods.
---

# Kubernetes Exec Tool

Single tool `k8s_exec` with action parameter for container execution operations.

## Actions

### Execute Command

Run a command inside a container:

```json
{
  "action": "exec",
  "namespace": "default",
  "pod_name": "nginx-abc123",
  "command": "ls -la /etc/nginx"
}
```

### Read File

Read a file from inside a container:

```json
{
  "action": "file_read",
  "namespace": "default",
  "pod_name": "nginx-abc123",
  "file_path": "/etc/nginx/nginx.conf"
}
```

### List Directory

List directory contents:

```json
{
  "action": "file_list",
  "namespace": "default",
  "pod_name": "nginx-abc123",
  "directory": "/var/log"
}
```

### View Environment Variables

```json
{
  "action": "env",
  "namespace": "default",
  "pod_name": "app-abc123"
}
```

### List Processes

```json
{
  "action": "process_list",
  "namespace": "default",
  "pod_name": "app-abc123"
}
```

### Network Check

Test connectivity from inside a container:

```json
{
  "action": "network_check",
  "namespace": "default",
  "pod_name": "app-abc123",
  "target_host": "redis-service",
  "target_port": 6379
}
```

## Common Workflows

### Debug a CrashLoopBackOff

1. Check environment variables: `{ "action": "env", ... }`
2. Read config files: `{ "action": "file_read", "file_path": "/app/config.yaml", ... }`
3. Check processes: `{ "action": "process_list", ... }`

### Verify Network Connectivity

1. Check DNS resolution: `{ "action": "exec", "command": "nslookup redis-service", ... }`
2. Test port: `{ "action": "network_check", "target_host": "redis-service", "target_port": 6379, ... }`

## Safety Notes

- All commands have a 30-second timeout
- Output exceeding 10KB is truncated
- For multi-container pods, specify the `container` parameter
- Requires `pods/exec` RBAC permission

## Permissions Required

- `pods/exec` - Execute commands in containers
- `pods/get` - Get pod information
