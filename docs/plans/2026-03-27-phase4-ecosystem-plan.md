# Phase 4: Ecosystem Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 4 ecosystem integration skills (Helm, YAML, Gateway API, Troubleshoot) 打通 K8s 生态工具链.

**Architecture:** k8s-helm 通过 shell exec 调用 helm CLI，k8s-yaml 使用 KubernetesObjectApi，k8s-gateway 使用 CustomObjectsApi（Gateway API 是 CRD），k8s-troubleshoot 是智能聚合 skill.

**Tech Stack:** TypeScript, @kubernetes/client-node, Zod, Vitest, OpenClaw plugin SDK, helm CLI

**Prerequisite:** Phase 3 completed (CustomObjectsApi already in K8sClients)

---

## Task 1: Extend K8sClients with KubernetesObjectApi

**Files:**
- Modify: `lib/client.ts`

**Step 1: Add KubernetesObjectApi**

```typescript
// Add to K8sClients interface:
objectApi: k8s.KubernetesObjectApi;

// Add to createK8sClients factory:
objectApi: k8s.KubernetesObjectApi.makeApiClient(kc),
```

- `KubernetesObjectApi` — 通用资源 CRUD，支持 apply/patch 任意资源

**Step 2: Run existing tests, commit**

---

## Task 2: k8s-helm skill

**Files:**
- Create: `skills/k8s-helm/SKILL.md`
- Create: `skills/k8s-helm/src/helm.ts`
- Create: `skills/k8s-helm/src/helm.test.ts`

### Schema

```typescript
const K8sHelmSchema = z.object({
  action: z.enum([
    "list",          // List installed releases
    "status",        // Release status and notes
    "history",       // Release revision history
    "values",        // Show computed values for a release
    "diff",          // Diff between current and pending/revision values
    "rollback",      // Rollback to previous revision
    "uninstall",     // Uninstall a release
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  release_name: z.string().optional(),
  revision: z.number().optional(),        // for history detail / rollback target
  output_format: z.enum(["table", "json", "yaml"]).optional(),
  context: z.string().optional(),
});
```

### Actions Detail

| Action | 说明 | 底层命令 |
|--------|------|---------|
| `list` | 列出已安装的 release | `helm list -n <ns> -o json` |
| `status` | Release 状态和 notes | `helm status <name> -n <ns> -o json` |
| `history` | 修订历史 | `helm history <name> -n <ns> -o json` |
| `values` | 当前生效的 values | `helm get values <name> -n <ns> -o json` |
| `diff` | 对比两个 revision 的 values 差异 | `helm get values --revision N` × 2, diff |
| `rollback` | 回滚到指定版本 | `helm rollback <name> <revision> -n <ns>` |
| `uninstall` | 卸载 release | `helm uninstall <name> -n <ns>` |

### Implementation Notes

- 通过 `child_process.execFile` 调用 helm CLI（不引入 helm SDK）
- JSON 输出解析后格式化为可读文本
- `diff` 对比两个 revision 的 values，输出增删改行
- 需要检测 helm 是否安装，不存在时返回友好错误

### Helper: execHelm()

```typescript
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function execHelm(args: string[], namespace?: string): Promise<string> {
  const fullArgs = [...args, "-o", "json"];
  if (namespace) fullArgs.push("-n", namespace);

  const { stdout } = await execFileAsync("helm", fullArgs, {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}
```

### Format Functions

- `formatReleaseList()` — NAMESPACE, NAME, REVISION, STATUS, CHART, APP-VERSION, UPDATED
- `formatReleaseStatus()` — 详细状态 + notes
- `formatReleaseHistory()` — REVISION, STATUS, CHART, APP-VERSION, DESCRIPTION
- `formatValuesDiff()` — 行级对比:
  ```
  Values diff: revision 3 → 4
  + replicas: 5
  - replicas: 3
  ~ image.tag: v1.2.0 → v1.3.0
  ```

### Tests (8+)

- Mock execFile to test all actions
- list parses helm JSON output correctly
- diff computes value differences
- handles helm not installed gracefully
- rollback/uninstall require release_name

**Commit:** `feat: add k8s-helm skill with 7 actions`

---

## Task 3: k8s-yaml skill

**Files:**
- Create: `skills/k8s-yaml/SKILL.md`
- Create: `skills/k8s-yaml/src/yaml.ts`
- Create: `skills/k8s-yaml/src/yaml.test.ts`

### Schema

```typescript
const K8sYamlSchema = z.object({
  action: z.enum([
    "export",      // Export existing resource as clean YAML
    "dry_run",     // Validate YAML without applying (server-side dry-run)
    "diff",        // Diff between live resource and provided YAML
    "apply",       // Apply YAML to cluster (server-side apply)
    "template",    // Generate YAML from simplified parameters
  ]),
  namespace: z.string().optional(),
  resource_type: z.string().optional(),   // e.g., "deployment", "service"
  resource_name: z.string().optional(),
  yaml_content: z.string().optional(),    // YAML string for apply/diff/dry_run
  clean: z.boolean().optional(),          // remove managedFields, status, etc. from export
  template_type: z.string().optional(),   // for template: "deployment", "service", "ingress", etc.
  template_params: z.record(z.string()).optional(), // key-value pairs for template
  context: z.string().optional(),
});
```

### Actions Detail

| Action | 说明 | 实现方式 |
|--------|------|---------|
| `export` | 导出现有资源为干净 YAML | 读资源 → 去除 managedFields/resourceVersion/uid/status → YAML |
| `dry_run` | 服务端 dry-run 验证 | `objectApi.create/patch` with `dryRun: "All"` |
| `diff` | 对比 live 和目标 YAML | 读 live → 和传入 YAML 做字段级对比 |
| `apply` | 应用 YAML 到集群 | `objectApi.patch` with server-side apply |
| `template` | 从简化参数生成 YAML | 内置模板 → 填充参数 → 返回 YAML |

### Clean Export Logic

移除以下字段以获得干净可复用的 YAML:
```typescript
const FIELDS_TO_REMOVE = [
  "metadata.managedFields",
  "metadata.resourceVersion",
  "metadata.uid",
  "metadata.creationTimestamp",
  "metadata.generation",
  "metadata.selfLink",
  "status",
];
```

### Built-in Templates

- `deployment` — name, image, replicas, port
- `service` — name, type, port, targetPort, selector
- `ingress` — name, host, path, serviceName, servicePort, tls
- `job` — name, image, command
- `cronjob` — name, image, command, schedule
- `configmap` — name, data(key-value)

### Dependencies

需要添加 `js-yaml` 依赖:
```bash
npm install js-yaml
npm install -D @types/js-yaml
```

### Tests (10+)

- export removes managedFields and status
- dry_run validates correct YAML
- dry_run rejects invalid YAML
- diff shows field-level differences
- template generates valid deployment YAML
- template generates valid service YAML

**Commit:** `feat: add k8s-yaml skill with 5 actions`

---

## Task 4: k8s-gateway skill

**Files:**
- Create: `skills/k8s-gateway/SKILL.md`
- Create: `skills/k8s-gateway/src/gateway.ts`
- Create: `skills/k8s-gateway/src/gateway.test.ts`

### Schema

```typescript
const K8sGatewaySchema = z.object({
  action: z.enum([
    "list_gateways",      // List Gateway resources
    "describe_gateway",   // Describe Gateway with listeners
    "list_routes",        // List HTTPRoute/GRPCRoute/TCPRoute/TLSRoute
    "describe_route",     // Describe route with rules and backends
    "list_classes",       // List GatewayClasses
    "status",             // Gateway + Routes health summary
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  name: z.string().optional(),
  route_type: z.enum(["HTTPRoute", "GRPCRoute", "TCPRoute", "TLSRoute"]).optional(),
  label_selector: z.string().optional(),
  context: z.string().optional(),
});
```

### Actions Detail

| Action | 说明 | API |
|--------|------|-----|
| `list_gateways` | 列出 Gateway 资源 | `customObjectsApi.listNamespacedCustomObject("gateway.networking.k8s.io", "v1", ns, "gateways")` |
| `describe_gateway` | Gateway 详情 + listeners | `customObjectsApi.getNamespacedCustomObject(...)` |
| `list_routes` | 列出路由资源 | `customObjectsApi.listNamespacedCustomObject(..., "httproutes"/"grpcroutes"/...)` |
| `describe_route` | 路由规则 + 后端 | `customObjectsApi.getNamespacedCustomObject(...)` |
| `list_classes` | GatewayClass 列表 | `customObjectsApi.listClusterCustomObject("gateway.networking.k8s.io", "v1", "gatewayclasses")` |
| `status` | 整体健康 | 聚合 Gateway conditions + Route conditions |

### Gateway API Constants

```typescript
const GATEWAY_GROUP = "gateway.networking.k8s.io";
const GATEWAY_VERSION = "v1";
const ROUTE_TYPES = {
  HTTPRoute: "httproutes",
  GRPCRoute: "grpcroutes",
  TCPRoute: "tcproutes",
  TLSRoute: "tlsroutes",
};
```

### Format Functions

- `formatGatewayList()` — NAMESPACE, NAME, CLASS, ADDRESSES, LISTENERS, AGE
- `formatGatewayDescribe()` — listeners 展开:
  ```
  Gateway: production/api-gateway
  Class: istio
  Addresses: 203.0.113.1

  Listeners:
    [1] http (port 80, HTTP)
        Allowed Routes: Same namespace
        Attached Routes: 3
    [2] https (port 443, HTTPS)
        TLS: secret/api-tls
        Attached Routes: 3
  ```
- `formatRouteList()` — NAMESPACE, NAME, HOSTNAMES, PARENT-REFS, AGE
- `formatRouteDescribe()` — rules + backends 展开
- `formatGatewayStatus()` — Gateway accepted/programmed + Route resolved/accepted

### Graceful Degradation

- Gateway API 可能未安装 — CRD 不存在时返回友好消息而非 API 错误
- 先检测 `customObjectsApi.listClusterCustomObject("gateway.networking.k8s.io", "v1", "gatewayclasses")` 是否报 404

### Tests (8+)

- list_gateways formats correctly
- describe_gateway shows listeners
- list_routes handles different route types
- status aggregates conditions
- handles Gateway API not installed gracefully

**Commit:** `feat: add k8s-gateway skill with 6 actions`

---

## Task 5: k8s-troubleshoot skill (智能故障排查)

**Files:**
- Create: `skills/k8s-troubleshoot/SKILL.md`
- Create: `skills/k8s-troubleshoot/src/troubleshoot.ts`
- Create: `skills/k8s-troubleshoot/src/troubleshoot.test.ts`

### Schema

```typescript
const K8sTroubleshootSchema = z.object({
  action: z.enum([
    "pod_not_ready",      // Guided: why is this pod not ready?
    "service_no_endpoints", // Guided: why does this service have no endpoints?
    "node_not_ready",     // Guided: why is this node NotReady?
    "pvc_pending",        // Guided: why is this PVC stuck in Pending?
    "deployment_stuck",   // Guided: why is this deployment not progressing?
    "diagnose",           // Auto-detect: analyze a resource and find issues
  ]),
  namespace: z.string().optional(),
  name: z.string().optional(),           // resource name
  resource_type: z.string().optional(),  // for diagnose: "pod", "service", "node", etc.
  context: z.string().optional(),
});
```

### Actions Detail

每个排查 action 执行多步检查链，返回排查路径和结论:

#### pod_not_ready

```
检查链:
1. Pod 存在? → 不存在则提示
2. Pod Phase? → Pending: 检查 Events (FailedScheduling?)
                         检查 Node 资源 (Insufficient cpu/memory?)
              → Running but not Ready: 检查 readinessProbe
                         检查 Container status (CrashLoopBackOff? OOMKilled?)
              → Failed: 检查 exit code + logs
3. 容器状态? → Waiting: ImagePullBackOff? CreateContainerConfigError?
             → Terminated: OOMKilled? Error?
4. Events? → 最近异常事件
5. Logs? → 最后 50 行日志
```

#### service_no_endpoints

```
检查链:
1. Service 存在?
2. Service selector 匹配了哪些 Pod?
3. 如果无匹配 Pod → selector labels 是否拼写错误? 对比 namespace 内所有 Pod labels
4. 如果有匹配 Pod → Pod 是否 Ready? 端口是否匹配?
5. 如果 Pod Ready 但无 Endpoint → 检查 Pod 是否通过 readinessGate
```

#### node_not_ready

```
检查链:
1. Node conditions (MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable)
2. Node events
3. kubelet 状态（通过 condition 推断）
4. Node 资源利用率 (如果 metrics 可用)
5. 最近被驱逐的 Pod
```

#### pvc_pending

```
检查链:
1. PVC status
2. StorageClass 是否存在?
3. StorageClass provisioner 是否已部署?
4. 是否有匹配的 PV (对于 static provisioning)?
5. Events (ProvisioningFailed?)
6. 节点亲和性冲突?
```

#### deployment_stuck

```
检查链:
1. Deployment conditions (Progressing? Available?)
2. ReplicaSet 状态
3. 新 Pod 是否创建? 是否 Pending/CrashLoop?
4. 资源配额是否超限?
5. PDB 是否阻止更新?
```

#### diagnose (自动检测)

根据 resource_type 自动选择合适的排查链:
- 检测资源当前状态 → 识别异常 → 执行对应排查链

### Output Format

```
=== Troubleshoot: Pod default/web-abc-1234 ===

[Step 1] Check Pod existence... OK
[Step 2] Check Pod phase... Running
[Step 3] Check container status...
  Container "web": CrashLoopBackOff (restart count: 15)
  Last exit code: 137 (OOMKilled)
[Step 4] Check resource limits...
  Memory limit: 128Mi
  Memory request: 64Mi
[Step 5] Check recent events...
  [2m ago] OOMKilling: Memory cgroup out of memory

--- Diagnosis ---
Root Cause: Container "web" is being OOM-killed (exit code 137).
  Memory limit (128Mi) is too low for the workload.

Recommendation:
  1. Increase memory limit: kubectl set resources deployment/web -c web --limits=memory=256Mi
  2. Check for memory leaks in the application
  3. Monitor with: k8s_metrics { action: "pod_resources", pod_name: "web-abc-1234" }
```

### Tests (10+)

- pod_not_ready detects CrashLoopBackOff
- pod_not_ready detects ImagePullBackOff
- pod_not_ready detects scheduling failure
- service_no_endpoints detects selector mismatch
- node_not_ready detects pressure conditions
- pvc_pending detects missing StorageClass
- deployment_stuck detects quota exceeded
- diagnose auto-routes to correct handler

**Commit:** `feat: add k8s-troubleshoot skill with 6 actions`

---

## Task 6: Register skills and bump version

**Files:**
- Modify: `index.ts` — add 4 imports + registrations
- Modify: `package.json` — bump to `1.7.0`
- Modify: `package.json` — add `js-yaml` + `@types/js-yaml` deps (for k8s-yaml)

Update description to "31 tools".

**Commit:** `feat: register Phase 4 ecosystem skills, bump to v1.7.0`

---

## Summary

| Task | Skill | Actions | Est. Lines |
|------|-------|---------|------------|
| 1 | lib/client.ts extension | — | ~4 |
| 2 | k8s-helm | 7 | ~420 |
| 3 | k8s-yaml | 5 | ~500 |
| 4 | k8s-gateway | 6 | ~400 |
| 5 | k8s-troubleshoot | 6 | ~650 |
| 6 | Registration + version | — | ~15 |
| **Total** | **4 skills** | **24 actions** | **~1,989** |

### New Dependencies

| Package | 用途 |
|---------|------|
| `js-yaml` | YAML 解析/序列化 (k8s-yaml skill) |
| `@types/js-yaml` | TypeScript 类型 |

### New API Clients

| API | 用途 |
|-----|------|
| `KubernetesObjectApi` | 通用资源 apply/patch (k8s-yaml) |

### External CLI Requirements

| Tool | 用途 | Fallback |
|------|------|---------|
| `helm` | Helm release 管理 | 友好错误: "helm CLI not found" |

### Prerequisites

- Phase 3 must be complete (CustomObjectsApi needed for k8s-gateway)
- helm CLI installed (for k8s-helm only)
