# K8s Ops Agent Feature Expansion Design

**Date**: 2026-03-24
**Status**: Approved
**Approach**: Phase-based, debugging-first (Plan A)

## Overview

Expand the `@openclaw/k8s` plugin from 4 skills (Pod, Deploy, Node, Svc) to 9 skills, adding container execution, advanced logging, metrics monitoring, and resource management capabilities. Target both DevOps/SRE professionals and developer/beginners.

## Phased Delivery

| Phase | Skills | Rationale |
|-------|--------|-----------|
| Phase 1 | k8s-exec + k8s-logs | Debugging essentials: 80% of daily ops |
| Phase 2 | k8s-metrics | Observability: see problems before they happen |
| Phase 3 | k8s-hpa + k8s-pvc | Resource management for advanced users |

## Phase 1: k8s-exec (Container Execution)

### Directory Structure

```
skills/k8s-exec/
├── SKILL.md
└── src/
    └── exec.ts
```

### Actions

| Action | Description | Target User |
|--------|-------------|-------------|
| `exec` | Execute a single command inside a container, return stdout/stderr | All |
| `file_read` | Read file contents from inside a container | Debug |
| `file_list` | List directory contents inside a container | Debug |
| `env` | View container environment variables | Developers |
| `process_list` | List running processes inside a container (ps aux) | SRE |
| `network_check` | Check network connectivity from container (curl/wget/nc) | SRE |

### Schema

```typescript
const K8sExecSchema = z.object({
  action: z.enum(["exec", "file_read", "file_list", "env", "process_list", "network_check"]),
  namespace: z.string().default("default"),
  pod_name: z.string(),                        // required
  container: z.string().optional(),             // for multi-container pods
  command: z.string().optional(),               // for exec action
  file_path: z.string().optional(),             // for file_read
  directory: z.string().default("/"),            // for file_list
  target_host: z.string().optional(),           // for network_check
  target_port: z.number().int().positive().optional(), // for network_check
  context: z.string().optional(),
});
```

### Safety Constraints

- **Read-first**: file_read, file_list, env, process_list are read-only operations
- **Timeout**: All commands have a 30-second timeout
- **Output truncation**: Output exceeding 10KB is truncated with a warning
- **RBAC guidance**: Documentation recommends restricting exec permissions via K8s RBAC

### Implementation Notes

- Uses `@kubernetes/client-node` Exec API (`k8s.Exec`)
- Creates a WebSocket connection to the container
- Collects stdout/stderr into buffers
- `env` action executes `env` or `printenv` command internally
- `process_list` executes `ps aux` or falls back to `ls /proc` if ps unavailable
- `network_check` tries `curl`, then `wget`, then `nc` in order

## Phase 1: k8s-logs (Advanced Logging)

### Directory Structure

```
skills/k8s-logs/
├── SKILL.md
└── src/
    └── logs.ts
```

### Differentiation from Existing k8s-pod logs

The existing `k8s-pod` `logs` action handles single-pod log viewing. The new `k8s-logs` skill provides **cross-pod aggregation, search, comparison, and statistics** capabilities.

### Actions

| Action | Description | Target User |
|--------|-------------|-------------|
| `search` | Search logs by keyword/regex with context lines | All |
| `multi_pod` | Aggregate logs from multiple pods by label selector, interleaved by timestamp | SRE |
| `since` | View logs within a specific time range (absolute or relative) | All |
| `compare` | Side-by-side comparison of logs from two pods | SRE |
| `stats` | Log statistics: error frequency, keyword counts, level distribution | SRE |
| `export` | Export logs as structured JSON format | Automation |

### Schema

```typescript
const K8sLogsSchema = z.object({
  action: z.enum(["search", "multi_pod", "since", "compare", "stats", "export"]),
  namespace: z.string().default("default"),
  pod_name: z.string().optional(),              // for single-pod operations
  label_selector: z.string().optional(),        // for multi_pod
  container: z.string().optional(),
  pattern: z.string().optional(),               // regex for search/stats
  since_time: z.string().optional(),            // ISO 8601 or relative ("1h", "30m")
  until_time: z.string().optional(),            // end of time range
  compare_pods: z.tuple([z.string(), z.string()]).optional(), // for compare
  tail_lines: z.number().int().positive().default(100),
  context: z.string().optional(),
});
```

### Implementation Notes

- **search**: Fetch logs via K8s API, apply regex in-memory, show matching lines with +-2 context lines
- **multi_pod**: List pods by label, fetch logs in parallel, merge by timestamp, prefix each line with pod name
- **compare**: Fetch logs from both pods, identify divergence points, highlight differences
- **stats**: Scan logs for ERROR/WARN/INFO patterns, count occurrences, show Top 10 frequent errors
- **Output limits**: Default 100 lines, maximum 1000 lines per operation
- **Time parsing**: Support both ISO 8601 (`2026-03-24T10:00:00Z`) and relative (`1h`, `30m`, `7d`)

## Phase 2: k8s-metrics (Monitoring)

### Directory Structure

```
skills/k8s-metrics/
├── SKILL.md
└── src/
    └── metrics.ts
```

### Actions

| Action | Description |
|--------|-------------|
| `pod_resources` | Pod CPU/memory usage (requires Metrics Server) |
| `node_resources` | Node resource usage and capacity |
| `top_pods` | Top N pods by resource consumption |
| `top_nodes` | Top N nodes by resource consumption |
| `namespace_usage` | Namespace-level resource summary |
| `capacity_report` | Cluster capacity planning report |

### Schema

```typescript
const K8sMetricsSchema = z.object({
  action: z.enum(["pod_resources", "node_resources", "top_pods", "top_nodes", "namespace_usage", "capacity_report"]),
  namespace: z.string().optional(),
  pod_name: z.string().optional(),
  node_name: z.string().optional(),
  sort_by: z.enum(["cpu", "memory"]).default("cpu"),
  top_n: z.number().int().positive().default(10),
  context: z.string().optional(),
});
```

### Implementation Notes

- Uses Metrics API (`metrics.k8s.io/v1beta1`) via custom API call
- Gracefully handles missing Metrics Server with clear error message
- `capacity_report` combines node capacity, allocatable, and actual usage
- Formats resource values: CPU as millicores (e.g., "250m"), memory as Mi/Gi

## Phase 3: k8s-hpa (Horizontal Pod Autoscaler)

### Actions

| Action | Description |
|--------|-------------|
| `list` | List HPAs with current/desired replicas and metrics |
| `describe` | Detailed HPA info including scaling events |
| `create` | Create HPA with min/max replicas and target metrics |
| `update` | Update HPA configuration |
| `delete` | Delete HPA |
| `status` | Quick HPA status check |

### Schema

```typescript
const K8sHpaSchema = z.object({
  action: z.enum(["list", "describe", "create", "update", "delete", "status"]),
  namespace: z.string().default("default"),
  hpa_name: z.string().optional(),
  deployment_name: z.string().optional(),       // for create
  min_replicas: z.number().int().positive().optional(),
  max_replicas: z.number().int().positive().optional(),
  target_cpu_percent: z.number().int().min(1).max(100).optional(),
  target_memory_percent: z.number().int().min(1).max(100).optional(),
  context: z.string().optional(),
});
```

## Phase 3: k8s-pvc (Persistent Volume Claims)

### Actions

| Action | Description |
|--------|-------------|
| `list` | List PVCs with status, capacity, and storage class |
| `describe` | Detailed PVC info including bound PV |
| `status` | Quick PVC status check |
| `expand` | Expand PVC capacity (if storage class allows) |

### Schema

```typescript
const K8sPvcSchema = z.object({
  action: z.enum(["list", "describe", "status", "expand"]),
  namespace: z.string().default("default"),
  pvc_name: z.string().optional(),
  new_size: z.string().optional(),              // for expand, e.g., "20Gi"
  label_selector: z.string().optional(),
  context: z.string().optional(),
});
```

## Cross-Cutting: Architecture Improvements

### Shared Library (`lib/`)

Extract common code from existing skills into reusable modules:

```
lib/
├── client.ts          # K8s client initialization and context management
├── format.ts          # Table formatting, age calculation, status symbols
├── errors.ts          # Standardized K8s API error wrapping
└── types.ts           # Shared TypeScript types
```

**client.ts**: Single function to create configured K8s API clients
```typescript
export function createK8sClients(config: PluginConfig) {
  const kc = new k8s.KubeConfig();
  // load from custom path or default
  // set context if specified
  return { coreApi, appsApi, metricsApi };
}
```

**format.ts**: Reusable formatters
```typescript
export function formatAge(date: Date): string;
export function formatTable(headers: string[], rows: string[][]): string;
export function statusSymbol(status: string): string;
```

**errors.ts**: Consistent error handling
```typescript
export function wrapK8sError(error: unknown, operation: string): string;
```

### Error Handling Standardization

- All skills use `wrapK8sError()` for consistent error messages
- Error messages include: operation name, resource type, namespace, and actionable suggestions
- Bilingual hints where appropriate (English primary, Chinese supplementary)

### Testing Strategy

- Mock `@kubernetes/client-node` APIs for unit tests
- One test file per skill: `skills/k8s-exec/src/exec.test.ts`
- Test each action's happy path and error cases
- Use a test runner compatible with the project (vitest or jest with ts support)

### Open-Source Readiness

| Item | Details |
|------|---------|
| LICENSE | MIT (permissive, ClawHub-friendly) |
| CONTRIBUTING.md | Contribution guidelines, development setup, PR process |
| CI Workflow | GitHub Actions: lint, type-check, test on push/PR |
| Versioning | Semantic versioning, CHANGELOG.md |

## RBAC Requirements (Updated)

New permissions needed beyond existing:

| Resource | Verbs | Skill |
|----------|-------|-------|
| pods/exec | create | k8s-exec |
| pods/log | get | k8s-logs (already required) |
| pods (metrics) | get, list | k8s-metrics |
| nodes (metrics) | get, list | k8s-metrics |
| horizontalpodautoscalers | get, list, create, update, delete | k8s-hpa |
| persistentvolumeclaims | get, list, update | k8s-pvc |

## Success Criteria

### Phase 1 (k8s-exec + k8s-logs)
- All 12 actions implemented and manually tested
- Unit tests for each action
- SKILL.md documentation for both skills
- Registered in index.ts
- README updated with new skills
- ClawHub-ready plugin manifest

### Phase 2 (k8s-metrics)
- All 6 actions implemented
- Graceful degradation when Metrics Server unavailable
- Capacity report generates actionable insights

### Phase 3 (k8s-hpa + k8s-pvc)
- All 10 actions implemented
- HPA create/update validates input constraints
- PVC expand checks storage class support
