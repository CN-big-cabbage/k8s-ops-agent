# Phase 3: Advanced Operations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 5 advanced operations skills (PDB, CRD, Health Check, Topology, Cost Analysis) for深度运维场景.

**Architecture:** k8s-pdb 使用 Phase 2 已加入的 PolicyV1Api，k8s-crd 使用 CustomObjectsApi（新增），其余三个是聚合分析 skill 不需要新 API.

**Tech Stack:** TypeScript, @kubernetes/client-node, Zod, Vitest, OpenClaw plugin SDK

**Prerequisite:** Phase 2 completed (PolicyV1Api already in K8sClients)

---

## Task 1: Extend K8sClients with CustomObjectsApi and ApiextensionsV1Api

**Files:**
- Modify: `lib/client.ts`

**Step 1: Add new API clients**

```typescript
// Add to K8sClients interface:
customObjectsApi: k8s.CustomObjectsApi;
apiextensionsApi: k8s.ApiextensionsV1Api;

// Add to createK8sClients factory:
customObjectsApi: kc.makeApiClient(k8s.CustomObjectsApi),
apiextensionsApi: kc.makeApiClient(k8s.ApiextensionsV1Api),
```

- `CustomObjectsApi` — 通用 CRD 资源读写
- `ApiextensionsV1Api` — CRD 定义查询

**Step 2: Run existing tests, commit**

---

## Task 2: k8s-pdb skill

**Files:**
- Create: `skills/k8s-pdb/SKILL.md`
- Create: `skills/k8s-pdb/src/pdb.ts`
- Create: `skills/k8s-pdb/src/pdb.test.ts`

### Schema

```typescript
const K8sPdbSchema = z.object({
  action: z.enum([
    "list",       // List PodDisruptionBudgets
    "describe",   // Describe PDB with disruption status
    "status",     // Quick status: allowed disruptions, current/expected pods
    "create",     // Create PDB
    "delete",     // Delete PDB
    "check",      // Check if a deployment/statefulset has PDB protection
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  pdb_name: z.string().optional(),
  target_selector: z.string().optional(),   // label selector for create
  min_available: z.union([z.number(), z.string()]).optional(),  // "50%" or 2
  max_unavailable: z.union([z.number(), z.string()]).optional(), // "25%" or 1
  workload_name: z.string().optional(),     // for check action
  label_selector: z.string().optional(),
  context: z.string().optional(),
});
```

### Actions Detail

| Action | 说明 | API 调用 |
|--------|------|---------|
| `list` | 列出 PDB | `policyApi.listNamespacedPodDisruptionBudget` |
| `describe` | PDB 详情 + 当前中断状态 | `policyApi.readNamespacedPodDisruptionBudget` |
| `status` | 快速状态：允许中断数、当前/期望 Pod 数 | 同 describe |
| `create` | 创建 PDB（支持 minAvailable 或 maxUnavailable） | `policyApi.createNamespacedPodDisruptionBudget` |
| `delete` | 删除 PDB | `policyApi.deleteNamespacedPodDisruptionBudget` |
| `check` | 检查某 workload 是否有 PDB 保护 | 读 workload selector → 匹配 PDB |

### Format Functions

- `formatPdbList()` — NAMESPACE, NAME, MIN-AVAILABLE, MAX-UNAVAILABLE, ALLOWED-DISRUPTIONS, AGE
- `formatPdbDescribe()` — 完整状态: currentHealthy, desiredHealthy, disruptionsAllowed, expectedPods
- `formatPdbCheck()` — WORKLOAD, HAS-PDB, PDB-NAME, PROTECTION-LEVEL

### Tests (8+)

**Commit:** `feat: add k8s-pdb skill with 6 actions`

---

## Task 3: k8s-crd skill

**Files:**
- Create: `skills/k8s-crd/SKILL.md`
- Create: `skills/k8s-crd/src/crd.ts`
- Create: `skills/k8s-crd/src/crd.test.ts`

### Schema

```typescript
const K8sCrdSchema = z.object({
  action: z.enum([
    "list_definitions",  // List all CRD definitions
    "describe_definition", // Describe CRD schema (versions, scope, columns)
    "list_resources",    // List instances of a specific CRD
    "describe_resource", // Describe a specific CR instance
    "delete_resource",   // Delete a specific CR instance
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  crd_name: z.string().optional(),       // e.g., "certificates.cert-manager.io"
  group: z.string().optional(),          // e.g., "cert-manager.io"
  version: z.string().optional(),        // e.g., "v1"
  plural: z.string().optional(),         // e.g., "certificates"
  resource_name: z.string().optional(),  // specific CR instance name
  label_selector: z.string().optional(),
  context: z.string().optional(),
});
```

### Actions Detail

| Action | 说明 | API 调用 |
|--------|------|---------|
| `list_definitions` | 列出所有 CRD 定义 | `apiextensionsApi.listCustomResourceDefinition` |
| `describe_definition` | CRD schema 详情 | `apiextensionsApi.readCustomResourceDefinition` |
| `list_resources` | 列出某 CRD 的所有实例 | `customObjectsApi.listNamespacedCustomObject` / `listClusterCustomObject` |
| `describe_resource` | 特定 CR 实例详情 | `customObjectsApi.getNamespacedCustomObject` / `getClusterCustomObject` |
| `delete_resource` | 删除 CR 实例 | `customObjectsApi.deleteNamespacedCustomObject` / `deleteClusterCustomObject` |

### Format Functions

- `formatCrdList()` — NAME, GROUP, VERSION, SCOPE, ESTABLISHED, AGE
- `formatCrdDescribe()` — 展示 versions, scope, additionalPrinterColumns, 简化 schema
- `formatCrList()` — 动态列基于 CRD 的 additionalPrinterColumns
- `formatCrDescribe()` — YAML-like 输出 spec 和 status

### Key Design Decisions

- CRD 资源可能是 Namespaced 或 Cluster-scoped，需根据 CRD 定义的 `scope` 字段自动选择 API
- `list_resources` 需要 group/version/plural 三元组，可从 `crd_name` 自动推导
- describe_definition 展示简化的 OpenAPI schema（避免过深嵌套，限制 3 层）

### Tests (8+)

**Commit:** `feat: add k8s-crd skill with 5 actions`

---

## Task 4: k8s-health skill (集群巡检)

**Files:**
- Create: `skills/k8s-health/SKILL.md`
- Create: `skills/k8s-health/src/health.ts`
- Create: `skills/k8s-health/src/health.test.ts`

### Schema

```typescript
const K8sHealthSchema = z.object({
  action: z.enum([
    "cluster",       // Full cluster health check
    "nodes",         // Node health summary
    "workloads",     // Workload health (unhealthy deployments, failed jobs, etc.)
    "networking",    // Service/Ingress/Endpoint health
    "storage",       // PV/PVC health (unbound, full, etc.)
    "certificates",  // TLS certificate expiry check
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  context: z.string().optional(),
});
```

### Actions Detail

| Action | 检查项 |
|--------|-------|
| `cluster` | 聚合所有检查，输出总分和分项评分 |
| `nodes` | Node Ready 状态, 磁盘/内存/PID 压力, 未调度节点, 内核版本一致性 |
| `workloads` | Deployment/StatefulSet/DaemonSet 未 Ready, CrashLoopBackOff Pods, 失败的 Jobs |
| `networking` | 无 Endpoint 的 Service, Ingress 无后端, Endpoint NotReady |
| `storage` | Unbound PVC, PV Released 但未回收, 存储容量告警 |
| `certificates` | 遍历 TLS Secret，检查证书过期时间（30/7/0 天告警） |

### Output Format

```
=== Cluster Health Report ===
Overall Score: 85/100

[Nodes]     ████████░░ 8/10  (2 issues)
  [WARN] node-3: MemoryPressure=True
  [WARN] node-5: cordoned (unschedulable)

[Workloads] █████████░ 9/10  (1 issue)
  [CRIT] default/api-server: 0/3 replicas ready (CrashLoopBackOff)

[Network]   ██████████ 10/10 (0 issues)

[Storage]   ████████░░ 8/10  (2 issues)
  [WARN] pvc/data-mysql-0: 92% capacity used
  [INFO] pv/old-backup: Released, not reclaimed

[Certs]     █████████░ 9/10  (1 issue)
  [WARN] secret/tls-api: expires in 15 days
```

### Data Sources

不需要新的 API client — 全部使用现有的:
- `coreApi` — Node, Pod, Service, Endpoint, PVC, PV, Secret, Event
- `appsApi` — Deployment, StatefulSet, DaemonSet
- `batchApi` — Job
- `networkingApi` — Ingress
- `storageApi` — StorageClass

### Tests (10+)

- cluster returns scored report
- nodes detects pressure conditions
- workloads finds unhealthy deployments
- certificates parses x509 expiry from TLS secrets
- cluster aggregates sub-check scores correctly

**Commit:** `feat: add k8s-health skill with 6 actions`

---

## Task 5: k8s-topology skill (资源拓扑)

**Files:**
- Create: `skills/k8s-topology/SKILL.md`
- Create: `skills/k8s-topology/src/topology.ts`
- Create: `skills/k8s-topology/src/topology.test.ts`

### Schema

```typescript
const K8sTopologySchema = z.object({
  action: z.enum([
    "service_chain",     // Service → Endpoints → Pods → Nodes
    "workload_chain",    // Deployment → ReplicaSet → Pods → Nodes
    "pod_dependencies",  // Pod → ConfigMaps, Secrets, PVCs, ServiceAccount
    "namespace_map",     // Namespace overview: all resources and relationships
  ]),
  namespace: z.string().optional(),
  name: z.string().optional(),         // Service/Deployment/Pod name
  pod_name: z.string().optional(),
  context: z.string().optional(),
});
```

### Actions Detail

| Action | 说明 | 输出 |
|--------|------|------|
| `service_chain` | Service → Endpoint → Pod → Node 全链路 | ASCII 树形图 |
| `workload_chain` | Deployment/SS/DS → RS → Pod → Node | ASCII 树形图 |
| `pod_dependencies` | Pod 依赖的所有资源 | 列表 + 状态 |
| `namespace_map` | 命名空间全景：资源数量和关系 | 概要表 |

### Output Format — ASCII Tree

```
Service: default/web-svc (ClusterIP: 10.96.0.100)
├── Endpoint: 10.244.1.5:8080
│   └── Pod: web-abc-1234 (Running) [node-1]
├── Endpoint: 10.244.2.8:8080
│   └── Pod: web-abc-5678 (Running) [node-2]
└── Endpoint: 10.244.3.2:8080
    └── Pod: web-abc-9012 (Running) [node-3]
```

```
Deployment: default/web (3/3 ready)
└── ReplicaSet: web-abc (3/3)
    ├── Pod: web-abc-1234 (Running) [node-1]
    │   ├── ConfigMap: web-config
    │   ├── Secret: web-tls
    │   └── PVC: web-data
    ├── Pod: web-abc-5678 (Running) [node-2]
    └── Pod: web-abc-9012 (Running) [node-3]
```

### Tests (8+)

- service_chain builds correct tree from Service to Pods
- workload_chain handles Deployment/StatefulSet/DaemonSet
- pod_dependencies finds all mounted volumes, envFrom refs
- namespace_map produces correct resource counts

**Commit:** `feat: add k8s-topology skill with 4 actions`

---

## Task 6: k8s-cost skill (成本分析)

**Files:**
- Create: `skills/k8s-cost/SKILL.md`
- Create: `skills/k8s-cost/src/cost.ts`
- Create: `skills/k8s-cost/src/cost.test.ts`

### Schema

```typescript
const K8sCostSchema = z.object({
  action: z.enum([
    "namespace_usage",    // Per-namespace request vs limit vs actual usage
    "overprovisioned",    // Find workloads with request >> actual usage
    "underprovisioned",   // Find workloads with actual usage >> request
    "idle_resources",     // Find idle/unused resources (0-replica deployments, completed jobs, etc.)
    "recommendations",    // Rightsizing recommendations
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  threshold: z.number().optional(),  // percentage threshold for over/under (default: 50)
  context: z.string().optional(),
});
```

### Actions Detail

| Action | 说明 | 数据来源 |
|--------|------|---------|
| `namespace_usage` | 每个命名空间的 Request/Limit/Actual 对比 | metrics API + Pod spec |
| `overprovisioned` | Request 远大于实际使用 (>threshold%) | metrics API + Pod spec |
| `underprovisioned` | 实际使用远大于 Request (>threshold%) | metrics API + Pod spec |
| `idle_resources` | 零副本 Deployment, 已完成 Job, 无 Pod 的 Service | 各种 list API |
| `recommendations` | 基于使用率的 rightsizing 建议 | metrics API + Pod spec |

### Output Format

```
=== Namespace Resource Analysis: production ===

                  CPU Request   CPU Limit   CPU Actual   Efficiency
Deployment/web    2000m         4000m       850m         42.5%
Deployment/api    1000m         2000m       920m         92.0%
StatefulSet/db    4000m         8000m       1200m        30.0%  [OVER]

Total: 7000m requested, 2970m used (42.4% efficiency)

Recommendations:
  1. [SAVE 57%] web: reduce CPU request from 2000m to 1000m
  2. [SAVE 70%] db: reduce CPU request from 4000m to 1500m
  3. [WARN] api: CPU at 92%, consider increasing request to 1200m
```

### Tests (8+)

- namespace_usage calculates efficiency correctly
- overprovisioned flags resources above threshold
- underprovisioned flags resources above threshold
- idle_resources finds zero-replica deployments
- recommendations produces actionable suggestions

**Commit:** `feat: add k8s-cost skill with 5 actions`

---

## Task 7: Register skills and bump version

**Files:**
- Modify: `index.ts` — add 5 imports + registrations
- Modify: `package.json` — bump to `1.6.0`

Update description to "27 tools".

**Commit:** `feat: register Phase 3 advanced ops skills, bump to v1.6.0`

---

## Summary

| Task | Skill | Actions | Est. Lines |
|------|-------|---------|------------|
| 1 | lib/client.ts extension | — | ~6 |
| 2 | k8s-pdb | 6 | ~380 |
| 3 | k8s-crd | 5 | ~450 |
| 4 | k8s-health | 6 | ~550 |
| 5 | k8s-topology | 4 | ~420 |
| 6 | k8s-cost | 5 | ~450 |
| 7 | Registration + version | — | ~15 |
| **Total** | **5 skills** | **26 actions** | **~2,271** |

### New API Clients

| API | 用途 |
|-----|------|
| `CustomObjectsApi` | 通用 CRD 资源读写 |
| `ApiextensionsV1Api` | CRD 定义查询 |

### Prerequisites

- Phase 2 must be complete (PolicyV1Api needed for k8s-pdb)
- Metrics Server required for k8s-cost
