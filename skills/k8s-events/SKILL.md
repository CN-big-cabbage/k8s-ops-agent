---
name: k8s-events
description: |
  Kubernetes event querying. Activate when user wants to list, filter, or search cluster events, check recent events, or export event data.
---

# Kubernetes Events Tool

Single tool `k8s_events` with action parameter for event querying and export.

## Actions

### List Events

List recent events sorted by time:

```json
{
  "action": "list",
  "namespace": "default",
  "limit": 50
}
```

Use `"all_namespaces": true` to list events across all namespaces.

### Filter Events

Filter events by type, resource, or reason:

```json
{
  "action": "filter",
  "namespace": "production",
  "event_type": "Warning",
  "resource_kind": "Pod",
  "reason": "BackOff"
}
```

At least one filter parameter is required (resource_kind, resource_name, event_type, reason).

### Recent Events

View events from a time window:

```json
{
  "action": "recent",
  "namespace": "default",
  "since_minutes": 30
}
```

### Export Events

Export events as JSON or table:

```json
{
  "action": "export",
  "namespace": "production",
  "event_type": "Warning",
  "format": "json"
}
```

## Common Workflows

### Quick Health Check

1. List recent warnings: `{ "action": "filter", "event_type": "Warning", "namespace": "production" }`
2. Check last 10 minutes: `{ "action": "recent", "since_minutes": 10, "namespace": "production" }`

### Export for Analysis

1. Export warning events as JSON: `{ "action": "export", "event_type": "Warning", "format": "json" }`

## Permissions Required

- `events/list` - List events
- `events/get` - Get event details
