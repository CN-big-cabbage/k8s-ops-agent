# Phase 2: Security & RBAC Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 3 security-focused skills (RBAC, NetworkPolicy, Security Audit) to fill the security/权限维度空白.

**Architecture:** k8s-rbac 使用 RbacAuthorizationV1Api（新增），k8s-netpol 使用现有 NetworkingV1Api，k8s-security 是聚合分析 skill 不需要新 API.

**Tech Stack:** TypeScript, @kubernetes/client-node, Zod, Vitest, OpenClaw plugin SDK

---

## Task 1: Extend K8sClients with RbacAuthorizationV1Api and PolicyV1Api

**Files:**
- Modify: `lib/client.ts`

**Step 1: Add new API clients**

```typescript
// Add to K8sClients interface:
rbacApi: k8s.RbacAuthorizationV1Api;
policyApi: k8s.PolicyV1Api;

// Add to createK8sClients factory:
rbacApi: kc.makeApiClient(k8s.RbacAuthorizationV1Api),
policyApi: kc.makeApiClient(k8s.PolicyV1Api),
```

- `RbacAuthorizationV1Api` — Role, ClusterRole, RoleBinding, ClusterRoleBinding, ServiceAccount
- `PolicyV1Api` — PodDisruptionBudget (Phase 3 也需要)

**Step 2: Run existing tests, commit**

---

## Task 2: k8s-rbac skill

**Files:**
- Create: `skills/k8s-rbac/SKILL.md`
- Create: `skills/k8s-rbac/src/rbac.ts`
- Create: `skills/k8s-rbac/src/rbac.test.ts`

### Schema

```typescript
const K8sRbacSchema = z.object({
  action: z.enum([
    "list_sa",           // List ServiceAccounts
    "describe_sa",       // Describe ServiceAccount (with bound secrets/tokens)
    "list_roles",        // List Roles + ClusterRoles
    "describe_role",     // Describe Role/ClusterRole (show rules)
    "list_bindings",     // List RoleBindings + ClusterRoleBindings
    "describe_binding",  // Describe binding (subjects + roleRef)
    "who_can",           // Check who can perform a verb on a resource
    "audit_sa",          // Audit: find overprivileged ServiceAccounts
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  name: z.string().optional(),          // SA/Role/Binding name
  cluster_scope: z.boolean().optional(), // ClusterRole vs Role
  verb: z.string().optional(),           // for who_can: get, list, create, delete, etc.
  resource: z.string().optional(),       // for who_can: pods, deployments, etc.
  label_selector: z.string().optional(),
  context: z.string().optional(),
});
```

### Actions Detail

| Action | 说明 | API 调用 |
|--------|------|---------|
| `list_sa` | 列出 ServiceAccount | `coreApi.listNamespacedServiceAccount` |
| `describe_sa` | SA 详情 + 绑定的 Secret/Token | `coreApi.readNamespacedServiceAccount` |
| `list_roles` | 列出 Role/ClusterRole | `rbacApi.listNamespacedRole` + `listClusterRole` |
| `describe_role` | 显示 rules (apiGroups, resources, verbs) | `rbacApi.readNamespacedRole` / `readClusterRole` |
| `list_bindings` | 列出 RoleBinding/ClusterRoleBinding | `rbacApi.listNamespacedRoleBinding` + `listClusterRoleBinding` |
| `describe_binding` | 显示 subjects + roleRef | `rbacApi.readNamespacedRoleBinding` / `readClusterRoleBinding` |
| `who_can` | 查谁能执行某操作 | 遍历所有 Binding，匹配 Role 的 rules |
| `audit_sa` | 审计过度授权的 SA | 遍历 SA → Binding → Role，标记 `*` 通配符 |

### Format Functions

- `formatSAList()` — NAMESPACE, NAME, SECRETS, AGE
- `formatRoleList()` — SCOPE, NAMESPACE, NAME, RULES-COUNT
- `formatBindingList()` — SCOPE, NAMESPACE, NAME, ROLE, SUBJECTS
- `formatRoleRules()` — 展开 rules: `apiGroups: [""] resources: ["pods"] verbs: ["get","list","watch"]`
- `formatWhoCanResult()` — WHO, TYPE(User/SA/Group), VIA-BINDING
- `formatAuditResult()` — SA, NAMESPACE, RISK-LEVEL(HIGH if wildcards), REASON

### Tests (10+)

- Schema validation for all 8 actions
- list_sa returns formatted table
- describe_role shows rules correctly
- who_can finds matching subjects
- audit_sa flags wildcard permissions as HIGH risk
- cluster_scope flag toggles between Role/ClusterRole

**Commit:** `feat: add k8s-rbac skill with 8 actions`

---

## Task 3: k8s-netpol skill

**Files:**
- Create: `skills/k8s-netpol/SKILL.md`
- Create: `skills/k8s-netpol/src/netpol.ts`
- Create: `skills/k8s-netpol/src/netpol.test.ts`

### Schema

```typescript
const K8sNetPolSchema = z.object({
  action: z.enum([
    "list",        // List NetworkPolicies
    "describe",    // Describe policy (ingress/egress rules parsed)
    "check_pod",   // Show which policies apply to a specific pod
    "create",      // Create NetworkPolicy from simplified params
    "delete",      // Delete NetworkPolicy
    "audit",       // Find namespaces with no NetworkPolicy (security gap)
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  policy_name: z.string().optional(),
  pod_name: z.string().optional(),       // for check_pod
  pod_selector: z.string().optional(),   // label selector for create
  ingress_allow: z.string().optional(),  // simplified: "namespace=monitoring" or "cidr=10.0.0.0/8"
  egress_allow: z.string().optional(),   // simplified egress rule
  label_selector: z.string().optional(),
  context: z.string().optional(),
});
```

### Actions Detail

| Action | 说明 | API 调用 |
|--------|------|---------|
| `list` | 列出 NetworkPolicy | `networkingApi.listNamespacedNetworkPolicy` |
| `describe` | 解析 ingress/egress 规则为可读格式 | `networkingApi.readNamespacedNetworkPolicy` |
| `check_pod` | 查 Pod 受哪些策略影响 | 读 Pod labels → 匹配所有 NetPol 的 podSelector |
| `create` | 从简化参数创建策略 | `networkingApi.createNamespacedNetworkPolicy` |
| `delete` | 删除策略 | `networkingApi.deleteNamespacedNetworkPolicy` |
| `audit` | 找没有 NetworkPolicy 的命名空间 | 遍历所有 NS，检查是否有 NetPol |

### Format Functions

- `formatNetPolList()` — NAMESPACE, NAME, POD-SELECTOR, POLICY-TYPES, AGE
- `formatNetPolDescribe()` — 将 ingress/egress rules 展开为可读文本:
  ```
  Ingress Rules:
    [1] From: namespace=monitoring, pods=app=prometheus
        Ports: TCP/9090
    [2] From: cidr=10.0.0.0/8
        Ports: TCP/80, TCP/443
  ```
- `formatPodPolicies()` — POD, POLICIES-APPLIED, INGRESS-RESTRICTED, EGRESS-RESTRICTED
- `formatAuditResult()` — NAMESPACE, HAS-NETPOL, POD-COUNT, RISK

### Tests (8+)

- Schema validation
- list returns formatted table
- describe parses ingress/egress rules
- check_pod matches pod labels against policy selectors
- audit identifies unprotected namespaces
- create builds correct NetworkPolicy object

**Commit:** `feat: add k8s-netpol skill with 6 actions`

---

## Task 4: k8s-security skill (聚合分析)

**Files:**
- Create: `skills/k8s-security/SKILL.md`
- Create: `skills/k8s-security/src/security.ts`
- Create: `skills/k8s-security/src/security.test.ts`

### Schema

```typescript
const K8sSecuritySchema = z.object({
  action: z.enum([
    "scan_namespace",    // Comprehensive security scan of a namespace
    "check_psa",         // Pod Security Admission compliance check
    "secret_audit",      // Find unused/stale secrets, check for sensitive patterns
    "image_audit",       // Check for latest tags, non-registry images, known vulnerabilities
    "privileged_pods",   // Find pods running as privileged/root
  ]),
  namespace: z.string().optional(),
  all_namespaces: z.boolean().optional(),
  label_selector: z.string().optional(),
  context: z.string().optional(),
});
```

### Actions Detail

| Action | 说明 | 数据来源 |
|--------|------|---------|
| `scan_namespace` | 综合安全扫描，返回评分 | 聚合以下所有检查 |
| `check_psa` | 检查 Pod 是否符合 restricted/baseline/privileged | 读 Pod spec, 检查 securityContext |
| `secret_audit` | 找未被任何 Pod 引用的 Secret；检查 Secret 名称是否暗示敏感数据 | 读所有 Secret + Pod，交叉比对 |
| `image_audit` | 标记 `:latest` 标签、无 registry 前缀、非受信 registry | 读所有 Pod，分析 container images |
| `privileged_pods` | 找 privileged=true, runAsRoot, hostNetwork 等高风险配置 | 读 Pod spec.securityContext |

### Format Functions

- `formatSecurityScan()` — 分区域输出:
  ```
  === Namespace Security Report: production ===
  Score: 72/100

  [HIGH] 2 privileged pods found
  [HIGH] 3 containers using :latest tag
  [MEDIUM] 5 unused secrets
  [LOW] 2 pods without resource limits

  Recommendations:
  1. Remove privileged flag from pod web-admin
  2. Pin image tags for deployment/frontend
  ```
- `formatPSACheck()` — POD, LEVEL(restricted/baseline/privileged), VIOLATIONS
- `formatSecretAudit()` — SECRET, NAMESPACE, REFERENCED-BY, STATUS(used/unused/stale)
- `formatImageAudit()` — POD, CONTAINER, IMAGE, ISSUES
- `formatPrivilegedPods()` — POD, NAMESPACE, RISK-FLAGS

### PSA Compliance Checks

按 K8s Pod Security Standards 检查:
- **Privileged:** privileged containers, hostPID, hostIPC, hostNetwork
- **Baseline:** non-default capabilities, hostPath volumes, hostPorts
- **Restricted:** non-root, drop ALL capabilities, readOnlyRootFilesystem, seccompProfile

### Tests (10+)

- scan_namespace produces scored report
- check_psa correctly classifies pods
- secret_audit finds unused secrets
- image_audit flags :latest and missing registry
- privileged_pods detects all risk flags

**Commit:** `feat: add k8s-security skill with 5 actions`

---

## Task 5: Register skills and bump version

**Files:**
- Modify: `index.ts` — add 3 imports + registrations
- Modify: `package.json` — bump to `1.5.0`

Update description to "22 tools".

**Commit:** `feat: register Phase 2 security skills, bump to v1.5.0`

---

## Summary

| Task | Skill | Actions | Est. Lines |
|------|-------|---------|------------|
| 1 | lib/client.ts extension | — | ~6 |
| 2 | k8s-rbac | 8 | ~550 |
| 3 | k8s-netpol | 6 | ~420 |
| 4 | k8s-security | 5 | ~500 |
| 5 | Registration + version | — | ~12 |
| **Total** | **3 skills** | **19 actions** | **~1,488** |

### New API Clients

| API | 用途 |
|-----|------|
| `RbacAuthorizationV1Api` | Role, ClusterRole, RoleBinding, ClusterRoleBinding |
| `PolicyV1Api` | PodDisruptionBudget (Phase 3 预备) |
