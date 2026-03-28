# K8s-Ops-Agent 测试环境测试方案

本文档提供在测试环境中验证 K8s-Ops-Agent 全部 31 个 skill 的完整方案。

---

## 目录

- [前置条件](#前置条件)
- [Step 1: 配置集群连接](#step-1-配置集群连接)
- [Step 2: 配置 OpenClaw 插件](#step-2-配置-openclaw-插件)
- [Step 3: 部署测试资源](#step-3-部署测试资源)
- [Step 4: 部署扩展测试资源](#step-4-部署扩展测试资源)
- [Step 5: 执行测试](#step-5-执行测试)
  - [P0 核心功能测试](#p0-核心功能测试25-分钟)
  - [P1 工作负载与运维测试](#p1-工作负载与运维测试30-分钟)
  - [P2 安全与网络测试](#p2-安全与网络测试20-分钟)
  - [P3 高级运维与生态测试](#p3-高级运维与生态测试25-分钟)
- [Step 6: 故障注入测试](#step-6-故障注入测试)
- [Step 7: 清理测试环境](#step-7-清理测试环境)
- [环境兼容性说明](#环境兼容性说明)
- [测试结果记录表](#测试结果记录表)

---

## 前置条件

| 条件 | 说明 |
|------|------|
| 测试集群 | 可用的 Kubernetes 集群，至少 2 个 worker 节点 |
| kubeconfig | 具有足够 RBAC 权限的 kubeconfig 文件 |
| kubectl | 本地已安装 kubectl CLI |
| Node.js | >= 18.x |
| helm (可选) | 测试 k8s-helm skill 需要 |
| metrics-server (可选) | 测试 k8s-metrics skill 需要集群已安装 |

### RBAC 最低权限要求

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: k8s-ops-agent-test
rules:
  # 核心资源 (Pod, Service, ConfigMap, Secret, Namespace, Event, Node)
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec", "services", "endpoints",
                "configmaps", "secrets", "namespaces", "events", "nodes",
                "persistentvolumeclaims", "persistentvolumes",
                "resourcequotas", "limitranges"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # 工作负载 (Deployment, StatefulSet, DaemonSet, Job, CronJob, HPA)
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets", "daemonsets", "replicasets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["batch"]
    resources: ["jobs", "cronjobs"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["autoscaling"]
    resources: ["horizontalpodautoscalers"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # 网络 (Ingress, NetworkPolicy)
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses", "networkpolicies"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # 存储
  - apiGroups: ["storage.k8s.io"]
    resources: ["storageclasses"]
    verbs: ["get", "list", "watch"]
  # RBAC
  - apiGroups: ["rbac.authorization.k8s.io"]
    resources: ["roles", "rolebindings", "clusterroles", "clusterrolebindings"]
    verbs: ["get", "list", "watch", "create", "delete"]
  # PDB
  - apiGroups: ["policy"]
    resources: ["poddisruptionbudgets"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  # CRD
  - apiGroups: ["apiextensions.k8s.io"]
    resources: ["customresourcedefinitions"]
    verbs: ["get", "list", "watch"]
  # Metrics
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods", "nodes"]
    verbs: ["get", "list"]
  # Gateway API (可选)
  - apiGroups: ["gateway.networking.k8s.io"]
    resources: ["gateways", "httproutes"]
    verbs: ["get", "list", "watch"]
```

---

## Step 1: 配置集群连接

拿到测试集群的 kubeconfig 后：

```bash
# 方式 A: 独立配置文件
cp /path/to/test-kubeconfig ~/.kube/config-test
export KUBECONFIG=~/.kube/config-test

# 方式 B: 合并到已有配置
export KUBECONFIG=~/.kube/config:/path/to/test-kubeconfig
kubectl config get-contexts

# 验证连通性
kubectl cluster-info
kubectl get nodes
```

确认输出中能看到集群节点且状态为 `Ready`。

记录以下信息供后续使用：

```
集群地址:    ___________________________
Context 名称: ___________________________
K8s 版本:    ___________________________
节点数量:    ___________________________
```

---

## Step 2: 配置 OpenClaw 插件

编辑 `~/.openclaw/openclaw.json`，将插件指向测试集群：

```json
{
  "plugins": {
    "entries": {
      "k8s": {
        "enabled": true,
        "kubeconfigPath": "/absolute/path/to/config-test",
        "defaultContext": "<测试集群 context 名称>"
      }
    }
  }
}
```

重启 OpenClaw：

```bash
openclaw start
```

---

## Step 3: 部署测试资源

使用项目自带的测试 yaml 快速创建基础测试环境：

```bash
# 部署 namespace + deployment + service + configmap
kubectl apply -f examples/01-nginx-test.yaml

# 等待所有 Pod 就绪
kubectl -n development get pods -w
```

预期结果：3 个 nginx-test Pod 全部 Running/Ready。

---

## Step 4: 部署扩展测试资源

为全面覆盖 31 个 skill，需要额外部署以下资源：

### 4.1 StatefulSet（测试 k8s-statefulset）

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: test-statefulset
  namespace: development
spec:
  serviceName: test-statefulset
  replicas: 2
  selector:
    matchLabels:
      app: test-statefulset
  template:
    metadata:
      labels:
        app: test-statefulset
    spec:
      containers:
      - name: nginx
        image: nginx:1.21
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 100m
            memory: 128Mi
EOF
```

### 4.2 Job 和 CronJob（测试 k8s-job, k8s-cronjob）

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: test-job
  namespace: development
spec:
  template:
    spec:
      containers:
      - name: worker
        image: busybox:1.36
        command: ["sh", "-c", "echo 'Job completed at' $(date) && sleep 10"]
        resources:
          requests:
            cpu: 50m
            memory: 32Mi
          limits:
            cpu: 100m
            memory: 64Mi
      restartPolicy: Never
  backoffLimit: 2
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: test-cronjob
  namespace: development
spec:
  schedule: "*/10 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: cron-worker
            image: busybox:1.36
            command: ["sh", "-c", "echo 'CronJob tick at' $(date)"]
            resources:
              requests:
                cpu: 50m
                memory: 32Mi
              limits:
                cpu: 100m
                memory: 64Mi
          restartPolicy: OnFailure
EOF
```

### 4.3 HPA（测试 k8s-hpa）

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: test-hpa
  namespace: development
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: nginx-test
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
EOF
```

### 4.4 NetworkPolicy（测试 k8s-netpol）

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: test-netpol
  namespace: development
spec:
  podSelector:
    matchLabels:
      app: nginx-test
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          environment: development
    ports:
    - protocol: TCP
      port: 80
EOF
```

### 4.5 Ingress（测试 k8s-ingress）

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: test-ingress
  namespace: development
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
  - host: test.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: nginx-test
            port:
              number: 80
EOF
```

> 注意：即使集群没有 Ingress Controller，Ingress 资源仍然可以创建和查询，只是不会实际生效路由。

### 4.6 PVC（测试 k8s-storage）

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: test-pvc
  namespace: development
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
EOF
```

> 注意：如果集群没有默认 StorageClass，PVC 会处于 Pending 状态，这也是有效的测试场景。

### 4.7 Role 和 RoleBinding（测试 k8s-rbac）

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: test-role
  namespace: development
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["pods/log"]
  verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: test-rolebinding
  namespace: development
subjects:
- kind: ServiceAccount
  name: default
  namespace: development
roleRef:
  kind: Role
  name: test-role
  apiGroup: rbac.authorization.k8s.io
EOF
```

### 4.8 PodDisruptionBudget（测试 k8s-pdb）

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: test-pdb
  namespace: development
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: nginx-test
EOF
```

### 4.9 ResourceQuota 和 LimitRange（测试 k8s-namespace）

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: v1
kind: ResourceQuota
metadata:
  name: test-quota
  namespace: development
spec:
  hard:
    pods: "20"
    requests.cpu: "4"
    requests.memory: 4Gi
    limits.cpu: "8"
    limits.memory: 8Gi
---
apiVersion: v1
kind: LimitRange
metadata:
  name: test-limitrange
  namespace: development
spec:
  limits:
  - default:
      cpu: 200m
      memory: 256Mi
    defaultRequest:
      cpu: 100m
      memory: 128Mi
    type: Container
EOF
```

### 验证所有资源就绪

```bash
echo "=== Pods ==="
kubectl -n development get pods
echo ""
echo "=== Deployments ==="
kubectl -n development get deployments
echo ""
echo "=== StatefulSets ==="
kubectl -n development get statefulsets
echo ""
echo "=== Jobs ==="
kubectl -n development get jobs
echo ""
echo "=== CronJobs ==="
kubectl -n development get cronjobs
echo ""
echo "=== HPA ==="
kubectl -n development get hpa
echo ""
echo "=== NetworkPolicies ==="
kubectl -n development get networkpolicies
echo ""
echo "=== PDB ==="
kubectl -n development get pdb
echo ""
echo "=== Quota ==="
kubectl -n development get resourcequota
echo ""
echo "=== Services ==="
kubectl -n development get svc
echo ""
echo "=== Ingress ==="
kubectl -n development get ingress
echo ""
echo "=== PVC ==="
kubectl -n development get pvc
echo ""
echo "=== Roles ==="
kubectl -n development get roles
echo ""
echo "=== RoleBindings ==="
kubectl -n development get rolebindings
```

---

## Step 5: 执行测试

在 OpenClaw 中依次执行以下测试指令。每条记录实际结果与预期是否一致。

### P0 核心功能测试（25 分钟）

这些是最基本的功能，必须全部通过。

| # | Skill | 测试指令 | 预期结果 | 通过 |
|---|-------|---------|---------|------|
| 1 | k8s-pod | "列出 development 的所有 Pod" | 返回 nginx-test + statefulset Pod，状态 Running | [ ] |
| 2 | k8s-pod | "查看 `<pod名>` 的详细信息" | 返回镜像、资源限制、探针配置等 | [ ] |
| 3 | k8s-pod | "显示 `<pod名>` 的日志" | 返回 nginx 日志内容 | [ ] |
| 4 | k8s-pod | "查看 nginx-test 各 Pod 的运行状态" | 返回 Pod 状态摘要 | [ ] |
| 5 | k8s-pod | "重启 nginx-test 的一个 Pod" | Pod 被删除后重建 | [ ] |
| 6 | k8s-deploy | "查看 nginx-test 部署的详情" | 返回副本数 3、镜像 nginx:1.21、滚动策略 | [ ] |
| 7 | k8s-deploy | "将 nginx-test 扩容到 5 副本" | 副本变为 5，新 Pod 创建 | [ ] |
| 8 | k8s-deploy | "将 nginx-test 缩回 3 副本" | 副本恢复为 3 | [ ] |
| 9 | k8s-deploy | "查看 nginx-test 的滚动更新状态" | 显示 rollout status | [ ] |
| 10 | k8s-svc | "列出 development 的 Service" | 返回 nginx-test (ClusterIP) 和 nginx-test-nodeport (NodePort) | [ ] |
| 11 | k8s-svc | "查看 nginx-test Service 的 endpoints" | 返回 Pod IP 列表 | [ ] |
| 12 | k8s-svc | "查看 nginx-test Service 的状态" | 返回 Service 健康状态 | [ ] |
| 13 | k8s-node | "列出所有节点" | 返回节点名称、角色、状态、版本 | [ ] |
| 14 | k8s-node | "查看 `<node名>` 节点详情" | 返回节点资源、标签、Taints | [ ] |
| 15 | k8s-namespace | "列出所有命名空间" | 包含 development、default、kube-system | [ ] |
| 16 | k8s-namespace | "查看 development 的配额信息" | 返回 ResourceQuota 详情 | [ ] |
| 17 | k8s-namespace | "查看 development 的 LimitRange 设置" | 返回 LimitRange 详情 | [ ] |
| 18 | k8s-events | "查看 development 最近的事件" | 返回 Pod 创建/调度事件 | [ ] |
| 19 | k8s-config | "列出 development 的 ConfigMap" | 包含 nginx-config | [ ] |
| 20 | k8s-config | "查看 nginx-config 的内容" | 返回 index.html 内容 | [ ] |
| 21 | k8s-config | "列出 development 的 Secret" | 返回 Secret 列表 | [ ] |

### P1 工作负载与运维测试（30 分钟）

| # | Skill | 测试指令 | 预期结果 | 通过 |
|---|-------|---------|---------|------|
| 22 | k8s-statefulset | "列出 development 的 StatefulSet" | 返回 test-statefulset，2/2 Ready | [ ] |
| 23 | k8s-statefulset | "查看 test-statefulset 详情" | 返回副本数、镜像等 | [ ] |
| 24 | k8s-daemonset | "列出 kube-system 的 DaemonSet" | 返回 kube-proxy 等系统组件 | [ ] |
| 25 | k8s-daemonset | "查看 kube-system 中 kube-proxy DaemonSet 的详情" | 返回 DaemonSet 配置和状态 | [ ] |
| 26 | k8s-job | "列出 development 的 Job" | 返回 test-job，状态 Complete | [ ] |
| 27 | k8s-job | "查看 test-job 的日志" | 返回 "Job completed at ..." | [ ] |
| 28 | k8s-cronjob | "列出 development 的 CronJob" | 返回 test-cronjob，schedule */10 | [ ] |
| 29 | k8s-cronjob | "查看 test-cronjob 的详情和最近触发记录" | 返回 CronJob 配置和历史 | [ ] |
| 30 | k8s-hpa | "列出 development 的 HPA" | 返回 test-hpa，目标 CPU 70% | [ ] |
| 31 | k8s-hpa | "查看 test-hpa 的当前状态" | 返回当前/目标副本数、指标 | [ ] |
| 32 | k8s-exec | "在 nginx-test Pod 中执行 ls /usr/share/nginx/html" | 返回 index.html | [ ] |
| 33 | k8s-exec | "查看 nginx-test Pod 的环境变量" | 返回容器环境变量列表 | [ ] |
| 34 | k8s-exec | "列出 nginx-test Pod 的进程" | 返回进程列表（nginx master/worker） | [ ] |
| 35 | k8s-logs | "搜索 nginx-test Pod 中包含 GET 的日志" | 返回匹配的日志行（可能为空） | [ ] |
| 36 | k8s-logs | "查看 nginx-test 最近 5 分钟的日志" | 返回时间范围内的日志 | [ ] |
| 37 | k8s-metrics | "查看 development 的 Pod 资源使用" | 返回 CPU/内存指标（需 metrics-server） | [ ] |
| 38 | k8s-metrics | "查看节点资源使用情况" | 返回节点 CPU/内存使用率 | [ ] |
| 39 | k8s-health | "检查集群健康状态" | 返回整体健康摘要 | [ ] |
| 40 | k8s-health | "检查 development 命名空间健康" | 返回该命名空间 Pod 状态摘要 | [ ] |
| 41 | k8s-troubleshoot | "诊断 nginx-test 部署" | 返回诊断报告，无异常 | [ ] |
| 42 | k8s-event-analysis | "分析 development 的事件趋势" | 返回事件时间线/摘要 | [ ] |

### P2 安全与网络测试（20 分钟）

| # | Skill | 测试指令 | 预期结果 | 通过 |
|---|-------|---------|---------|------|
| 43 | k8s-rbac | "列出 development 的 Role" | 返回 test-role | [ ] |
| 44 | k8s-rbac | "查看 test-role 的权限详情" | 返回 pods get/list/watch, pods/log get | [ ] |
| 45 | k8s-rbac | "列出 development 的 RoleBinding" | 返回 test-rolebinding | [ ] |
| 46 | k8s-rbac | "列出 development 的 ServiceAccount" | 返回 default SA | [ ] |
| 47 | k8s-netpol | "列出 development 的 NetworkPolicy" | 返回 test-netpol | [ ] |
| 48 | k8s-netpol | "查看 test-netpol 详情" | 返回入站规则（TCP 80，来源: environment=development 标签的 namespace） | [ ] |
| 49 | k8s-security | "扫描 development 命名空间的安全状况" | 返回安全配置分析 | [ ] |
| 50 | k8s-security | "检查 development 中是否有特权 Pod" | 返回特权容器检查结果 | [ ] |
| 51 | k8s-pdb | "列出 development 的 PDB" | 返回 test-pdb，minAvailable=1 | [ ] |
| 52 | k8s-pdb | "查看 test-pdb 详情" | 返回允许中断数等 | [ ] |
| 53 | k8s-ingress | "列出 development 的 Ingress" | 返回 test-ingress，host: test.example.com | [ ] |
| 54 | k8s-ingress | "查看 test-ingress 的路由规则" | 返回 path / -> nginx-test:80 | [ ] |
| 55 | k8s-storage | "列出 development 的 PVC" | 返回 test-pvc (Pending 或 Bound) | [ ] |
| 56 | k8s-storage | "列出 StorageClass" | 返回可用的存储类 | [ ] |
| 57 | k8s-storage | "查看 test-pvc 详情" | 返回 PVC 容量、状态、绑定的 PV | [ ] |

### P3 高级运维与生态测试（25 分钟）

> 注意：部分 skill（如 k8s-deploy）在 P0 中已测试基础读操作，这里测试写操作和高级功能。

| # | Skill | 测试指令 | 预期结果 | 通过 |
|---|-------|---------|---------|------|
| 58 | k8s-deploy | "更新 nginx-test 镜像为 nginx:1.22" | 触发滚动更新 | [ ] |
| 59 | k8s-deploy | "查看 nginx-test 部署历史" | 显示至少 2 个版本 | [ ] |
| 60 | k8s-deploy | "回滚 nginx-test 到上个版本" | 镜像恢复为 nginx:1.21 | [ ] |
| 61 | k8s-deploy | "重启 nginx-test 部署" | 触发滚动重启 | [ ] |
| 62 | k8s-topology | "查看 nginx-test 的 Pod 分布在哪些节点上" | 返回 Pod-Node 分布拓扑 | [ ] |
| 63 | k8s-topology | "查看 development 的服务依赖链" | 返回 Service → Pod 拓扑关系 | [ ] |
| 64 | k8s-cost | "估算 development 的资源成本" | 返回命名空间资源使用和成本估算 | [ ] |
| 65 | k8s-cost | "查找 development 中资源超配的 Pod" | 返回资源优化建议 | [ ] |
| 66 | k8s-crd | "列出集群的 CRD" | 返回 CRD 列表 | [ ] |
| 67 | k8s-portforward | "转发 nginx-test Service 的 80 端口到本地 8080" | 端口转发建立 | [ ] |
| 68 | k8s-portforward | "列出当前的端口转发" | 返回活跃的端口转发列表 | [ ] |
| 69 | k8s-helm | "列出所有 Helm release" | 返回列表（需 helm CLI） | [ ] |
| 70 | k8s-yaml | "对 examples/01-nginx-test.yaml 执行 dry-run 验证" | 返回服务端验证结果 | [ ] |
| 71 | k8s-yaml | "导出 development 中 nginx-test Deployment 的 YAML" | 返回 YAML 内容 | [ ] |
| 72 | k8s-gateway | "列出所有 Gateway 资源" | 返回列表（需 Gateway API CRD） | [ ] |

---

## Step 6: 故障注入测试

在验证基础功能后，通过故障注入测试插件的诊断能力。

> **重要**：每个场景执行前后，都需要确认 Deployment 处于健康状态。如果前一个场景恢复不完整，运行以下命令重置：
> ```bash
> kubectl apply -f examples/01-nginx-test.yaml
> kubectl rollout status deployment/nginx-test -n development --timeout=120s
> ```

### 健康检查点（每个场景前后执行）

```bash
# 确认 Deployment 健康
kubectl rollout status deployment/nginx-test -n development --timeout=60s
kubectl -n development get pods -l app=nginx-test
# 预期: 3/3 Pod Running, 0 restarts
```

### 场景 1: 镜像拉取失败（ImagePullBackOff）

```bash
# 注入故障
kubectl set image deployment/nginx-test nginx=nginx:nonexistent -n development

# 等待故障出现（约 30 秒）
kubectl -n development get pods -w
```

**测试指令**: "nginx-test 好像有问题，帮我排查"

**预期**: 插件识别出 ImagePullBackOff，给出原因和修复建议。

```bash
# 恢复
kubectl rollout undo deployment/nginx-test -n development
kubectl rollout status deployment/nginx-test -n development --timeout=120s
```

### 场景 2: OOMKilled（内存溢出）

```bash
# 注入故障: 将内存限制设为极低值（16Mi 足以让 nginx 启动后被 OOM）
kubectl set resources deployment/nginx-test --limits=memory=16Mi -n development

# 等待 Pod 被 OOMKilled（可能出现 CrashLoopBackOff + OOMKilled reason）
kubectl -n development get pods -w
```

**测试指令**: "检查 development 中有异常的 Pod"

**预期**: 插件识别出 OOMKilled/CrashLoopBackOff 状态，建议增大内存限制。

```bash
# 恢复（重新 apply 原始配置，避免 set resources 留下脏修订历史）
kubectl apply -f examples/01-nginx-test.yaml
kubectl rollout status deployment/nginx-test -n development --timeout=120s
```

### 场景 3: 就绪探针失败（Not Ready）

```bash
# 注入故障: 将 readinessProbe 指向不存在的路径
kubectl patch deployment nginx-test -n development --type='json' \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/nonexistent"}]'

# 等待 Pod 变为 Not Ready
kubectl -n development get pods -w
```

**测试指令**: "nginx-test 的 Pod 都 Ready 了吗？"

**预期**: 插件发现 Pod 未就绪，指出 readinessProbe 失败。

```bash
# 恢复（重新 apply 原始配置确保干净状态）
kubectl apply -f examples/01-nginx-test.yaml
kubectl rollout status deployment/nginx-test -n development --timeout=120s
```

### 场景 4: 资源配额超限

```bash
# 注入故障: 设置严格配额
kubectl patch resourcequota test-quota -n development \
  --type='json' -p='[{"op":"replace","path":"/spec/hard/pods","value":"3"}]'

# 尝试扩容（会被配额阻止）
kubectl scale deployment nginx-test --replicas=5 -n development
```

**测试指令**: "为什么 nginx-test 扩容不到 5 个副本？"

**预期**: 插件识别出配额限制，给出调整建议。

```bash
# 恢复
kubectl patch resourcequota test-quota -n development \
  --type='json' -p='[{"op":"replace","path":"/spec/hard/pods","value":"20"}]'
kubectl scale deployment nginx-test --replicas=3 -n development
kubectl rollout status deployment/nginx-test -n development --timeout=60s
```

### 场景 5: 节点压力（仅读操作）

**测试指令**: "检查哪些节点资源使用率较高"

**预期**: 插件返回节点资源使用摘要（需 metrics-server）。

---

## Step 7: 清理测试环境

推荐直接删除命名空间（最简单、最彻底）：

```bash
# 方式 A: 一次性删除整个命名空间（推荐）
kubectl delete namespace development
```

如果需要保留命名空间，逐个删除测试资源：

```bash
# 方式 B: 逐个删除
# 先删除依赖资源
kubectl delete hpa test-hpa -n development
kubectl delete pdb test-pdb -n development
kubectl delete networkpolicy test-netpol -n development
kubectl delete ingress test-ingress -n development
kubectl delete rolebinding test-rolebinding -n development
kubectl delete role test-role -n development
kubectl delete pvc test-pvc -n development
kubectl delete cronjob test-cronjob -n development
kubectl delete job test-job -n development
kubectl delete statefulset test-statefulset -n development
kubectl delete resourcequota test-quota -n development
kubectl delete limitrange test-limitrange -n development

# 最后删除基础资源
kubectl delete -f examples/01-nginx-test.yaml
```

> 注意：端口转发是进程级别的 TCP 连接，会在 OpenClaw 会话结束时自动断开，无需集群侧清理。

---

## 环境兼容性说明

部分 skill 依赖集群特定组件，如果缺失则跳过对应测试：

| 组件 | 影响的 Skill | 检查方式 |
|------|------------|---------|
| **metrics-server** | k8s-metrics（pod_resources, node_resources, top_pods, top_nodes） | `kubectl top nodes` 是否有输出 |
| **helm CLI** | k8s-helm（所有 action） | `helm version` |
| **Gateway API CRD** | k8s-gateway（所有 action） | `kubectl get crd gateways.gateway.networking.k8s.io` |
| **Ingress Controller** | k8s-ingress（rules, tls 等） | `kubectl get pods -A \| grep ingress` |
| **NetworkPolicy 支持** | k8s-netpol（enforce 功能） | CNI 插件需支持 NetworkPolicy（Calico/Cilium） |

### 不同集群类型的注意事项

**Kind 集群**:
- 默认无 metrics-server，需手动安装并添加 `--kubelet-insecure-tls` 参数
- 默认无 Ingress Controller，k8s-ingress 仅测试 list 操作
- NetworkPolicy 默认不生效（需要使用 Calico CNI）

**kubeasz 二进制集群**（如现有 172.16.190.x 环境）:
- 通常已有 metrics-server
- 确认 CNI 插件类型以判断 NetworkPolicy 支持情况
- Harbor 镜像需确认节点可拉取

**云厂商托管集群**（ACK/TKE/EKS）:
- 通常组件齐全
- 注意 RBAC 权限可能受限
- LoadBalancer 类型 Service 会产生费用

---

## 测试结果记录表

测试完成后，填写以下汇总：

```
测试日期:     _______________
集群类型:     _______________
K8s 版本:     _______________
测试人员:     _______________

P0 核心测试:   ___ / 21 通过
P1 运维测试:   ___ / 21 通过
P2 安全测试:   ___ / 15 通过
P3 高级测试:   ___ / 15 通过
故障注入测试:  ___ / 5  通过

总计:         ___ / 77 通过
跳过:         ___ 项（原因: _____________）

发现的问题:
1. _______________________________________________
2. _______________________________________________
3. _______________________________________________
```
