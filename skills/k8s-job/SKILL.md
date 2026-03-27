---
name: k8s-job
description: |
  Kubernetes Job operations. Activate when user mentions jobs, batch tasks, one-off commands, migrations, or backups on K8s.
---

# Kubernetes Job Tool

Single tool `k8s_job` with action parameter for all Job operations.

## Actions

### List Jobs

```json
{ "action": "list", "namespace": "default" }
{ "action": "list", "all_namespaces": true }
```

### Describe Job

```json
{ "action": "describe", "job_name": "backup-job" }
```

### Status

```json
{ "action": "status", "job_name": "backup-job" }
```

### Logs

```json
{ "action": "logs", "job_name": "backup-job" }
{ "action": "logs", "job_name": "backup-job", "tail_lines": 50 }
```

### Create Job

```json
{ "action": "create", "job_name": "my-job", "image": "busybox:latest", "command": ["echo", "hello"] }
```

### Delete Job

```json
{ "action": "delete", "job_name": "backup-job" }
```
