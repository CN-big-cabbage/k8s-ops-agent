---
name: k8s-cronjob
description: |
  Kubernetes CronJob operations. Activate when user mentions cronjobs, scheduled tasks, periodic jobs, or cron schedules on K8s.
---

# Kubernetes CronJob Tool

Single tool `k8s_cronjob` with action parameter for all CronJob operations.

## Actions

### List CronJobs

```json
{ "action": "list", "namespace": "default" }
{ "action": "list", "all_namespaces": true }
```

### Describe CronJob

```json
{ "action": "describe", "cronjob_name": "nightly-backup" }
```

### Status

```json
{ "action": "status", "cronjob_name": "nightly-backup" }
```

### Suspend / Resume

```json
{ "action": "suspend", "cronjob_name": "nightly-backup", "suspend": true }
{ "action": "suspend", "cronjob_name": "nightly-backup", "suspend": false }
```

### Trigger Manual Run

```json
{ "action": "trigger", "cronjob_name": "nightly-backup" }
```

### Job History

```json
{ "action": "history", "cronjob_name": "nightly-backup" }
{ "action": "history", "cronjob_name": "nightly-backup", "limit": 5 }
```
