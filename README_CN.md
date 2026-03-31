# OpenClaw Kubernetes 插件

[English](README.md) | 简体中文

OpenClaw 的 Kubernetes 运维插件，提供 K8s 资源管理工具。

## 功能特性

### Skills（32 个工具）

#### 核心资源
- **k8s-pod**: Pod 管理（列表、详情、日志、重启、状态）
- **k8s-deploy**: Deployment 管理（列表、详情、扩缩容、滚动更新状态/历史/重启/回滚、更新镜像）
- **k8s-node**: Node 管理（列表、详情、状态、封锁/解封、驱逐、污点、标签）
- **k8s-svc**: Service 管理（列表、详情、端点查询、状态）
- **k8s-config**: ConfigMap/Secret 管理（列表、详情、获取数据、创建、更新、删除）
- **k8s-ingress**: Ingress 管理（列表、详情、路由规则、TLS 配置、注解、更新、删除）
- **k8s-storage**: PVC/PV/StorageClass 管理（列表、详情、容量查询、创建、删除、扩容）
- **k8s-namespace**: 命名空间操作（列表、详情、配额、限制、创建、删除）

#### 运维操作
- **k8s-exec**: 容器执行（执行命令、读取文件、列出目录、查看环境变量、进程列表、网络连通性检查）
- **k8s-portforward**: 端口转发（创建、列表、关闭 Pod/Service 端口转发）
- **k8s-logs**: 高级日志操作（搜索、多 Pod 聚合、时间范围过滤、对比、统计、导出）
- **k8s-metrics**: 资源指标监控（Pod 资源、Node 资源、Pod 排行、Node 排行、命名空间用量、容量报告）

#### 监控
- **k8s-events**: 事件查询（列表、过滤、最近事件、导出）
- **k8s-event-analysis**: 事件分析（时间线、异常检测、关联分析、健康摘要）

#### 工作负载管理
- **k8s-statefulset**: StatefulSet 操作（列表、详情、状态、扩缩容、滚动重启/回滚、更新镜像）
- **k8s-daemonset**: DaemonSet 操作（列表、详情、状态、滚动重启/回滚、更新镜像）
- **k8s-job**: Job 操作（列表、详情、状态、日志、创建、删除）
- **k8s-cronjob**: CronJob 操作（列表、详情、状态、暂停、恢复、触发、创建、删除）
- **k8s-hpa**: HPA 操作（列表、详情、状态、创建、更新、删除）

#### 安全与 RBAC
- **k8s-rbac**: RBAC 操作（ServiceAccount/Role/ClusterRole/Binding 的列表和详情、权限检查、审计）
- **k8s-netpol**: 网络策略操作（列表、详情、Pod 策略检查、创建、删除、审计）
- **k8s-security**: 安全审计（镜像扫描、Pod 安全检查、RBAC 审计、Secret 审计）

#### 高级运维
- **k8s-pdb**: PodDisruptionBudget 操作（列表、详情、状态、创建、删除、保护检查）
- **k8s-crd**: CRD 操作（列表、详情、自定义资源的获取和列举）
- **k8s-health**: 集群健康检查（组件、节点、Pod、etcd、网络、综合报告）
- **k8s-topology**: 集群拓扑（节点分布、Pod 放置、区域分布、亲和性分析）
- **k8s-cost**: 成本分析（命名空间成本、节点成本、闲置资源、优化建议）

#### 生态集成
- **k8s-helm**: Helm 操作（列出 Release、详情、历史、Values、回滚）
- **k8s-yaml**: YAML 管理（导出、校验、对比、应用、模板生成）
- **k8s-gateway**: Gateway API 操作（列表、详情、路由、状态）
- **k8s-troubleshoot**: 故障排查（诊断 Pod、Service、Node、网络、DNS）

#### 系统监控
- **sys-monitor**: 主机监控（通过 SSH 监控 CPU、内存、磁盘、网络、进程、系统信息）

## 安装

### 前提条件

- 已安装并运行 [OpenClaw](https://docs.openclaw.ai/)
- Node.js >= 18
- 已安装 `kubectl`，且 `~/.kube/config` 中有有效的集群配置

### 第一步：克隆仓库

```bash
git clone https://github.com/CN-big-cabbage/k8s-ops-agent.git
cd k8s-ops-agent
```

### 第二步：安装依赖

```bash
npm install
```

### 第三步：创建必要的符号链接

插件依赖 OpenClaw 的 SDK 和 TypeBox，需要创建指向全局 OpenClaw 包的符号链接：

```bash
ln -s /usr/local/lib/node_modules/openclaw node_modules/openclaw
mkdir -p node_modules/@sinclair
ln -s /usr/local/lib/node_modules/openclaw/node_modules/@sinclair/typebox node_modules/@sinclair/typebox
```

> **提示：** 如果你的 OpenClaw 全局路径不同，运行 `npm root -g` 查找实际路径后调整。

### 第四步：将插件安装到 OpenClaw

```bash
openclaw plugins install --link /path/to/k8s-ops-agent
```

使用 `--link` 标志会创建对本地目录的引用，代码更新后无需重新安装即可生效。

### 第五步：验证插件已加载

```bash
openclaw plugins list | grep k8s
```

期望输出：
```
│ Kubernetes   │ k8s      │ openclaw │ loaded   │ ~/path/to/k8s-ops-agent/index.ts │ 1.8.0 │
```

### 第六步：重启 Gateway

```bash
openclaw gateway restart
```

### （可选）配置 kubeconfig 路径

如果 kubeconfig 不在默认的 `~/.kube/config`，编辑 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "entries": {
      "k8s": {
        "enabled": true,
        "config": {
          "kubeconfigPath": "/custom/path/to/kubeconfig",
          "defaultContext": "prod-cluster"
        }
      }
    }
  }
}
```

### 安装常见问题

| 报错信息 | 原因 | 解决方案 |
|----------|------|----------|
| `Cannot find module 'openclaw/plugin-sdk'` | 缺少 openclaw 符号链接 | 重新创建符号链接（第三步） |
| `plugin not found: k8s` | 未通过 CLI 安装 | 执行 `openclaw plugins install --link`（第四步） |
| `missing register/activate export` | 插件入口方法错误 | 确保 `index.ts` 使用 `register()` 而非 `load()` |
| `kubectl 未配置` | 没有 kubeconfig | 将 kubeconfig 复制到 `~/.kube/config` |

## 使用方法

### 列出 Pods

```
列出 default 命名空间中的所有 pods
```

Agent 将使用：
```json
{ "action": "list", "namespace": "default" }
```

### 查看 Pod 日志

```
显示 production 命名空间中 nginx-deployment-abc123 的日志
```

Agent 将使用：
```json
{ "action": "logs", "namespace": "production", "pod_name": "nginx-deployment-abc123" }
```

### 排查崩溃的 Pod

```
payment-service pod 一直崩溃，帮我调试一下
```

Agent 将执行：
1. 检查 pod 状态
2. 获取之前的日志（来自崩溃的容器）
3. 描述 pod 查看事件

### 重启 Pod

```
重启 staging 中的 frontend-app-xyz pod
```

Agent 将使用：
```json
{ "action": "restart", "namespace": "staging", "pod_name": "frontend-app-xyz" }
```

### Deployment 管理

#### 扩缩容

```
将 nginx-deployment 扩容到 5 个副本
```

```json
{ "action": "scale", "namespace": "default", "deployment_name": "nginx-deployment", "replicas": 5 }
```

#### 滚动更新

```
更新 api-service 的镜像到 v2.0
```

```json
{ "action": "update-image", "namespace": "production", "deployment_name": "api-service", "image": "myregistry/api-service:v2.0" }
```

#### 回滚

```
回滚 payment-gateway 到上一个版本
```

```json
{ "action": "rollout-undo", "namespace": "production", "deployment_name": "payment-gateway" }
```

### Node 管理

#### 维护节点

```
封锁 node-01 准备维护
```

```json
{ "action": "cordon", "node_name": "node-01" }
```

#### 驱逐 Pods

```
驱逐 node-02 上的所有 pods
```

```json
{ "action": "drain", "node_name": "node-02" }
```

### Service 管理

#### 查看端点

```
检查 redis-service 的后端端点
```

```json
{ "action": "endpoints", "namespace": "default", "service_name": "redis-service" }
```

### 容器执行

#### 在容器中执行命令

```
查看 nginx pod 中 /etc/nginx 目录的内容
```

```json
{ "action": "exec", "namespace": "default", "pod_name": "nginx-abc123", "command": "ls -la /etc/nginx" }
```

#### 网络连通性检查

```
检查 app pod 是否能连接到 redis
```

```json
{ "action": "network_check", "namespace": "default", "pod_name": "app-abc123", "target_host": "redis-service", "target_port": 6379 }
```

### 高级日志

#### 搜索日志

```
搜索 api-server 日志中的错误
```

```json
{ "action": "search", "namespace": "default", "pod_name": "api-server-xyz", "pattern": "ERROR|WARN", "tail_lines": 500 }
```

#### 多 Pod 日志聚合

```
显示所有 api pod 的日志
```

```json
{ "action": "multi_pod", "namespace": "production", "label_selector": "app=api-server", "tail_lines": 100 }
```

#### 日志统计

```
分析 api-server 的日志模式
```

```json
{ "action": "stats", "namespace": "default", "pod_name": "api-server-xyz", "tail_lines": 1000 }
```

### 资源指标

#### 查看 Pod 资源用量排行

```
查看 production 命名空间中 CPU 占用最高的 Pod
```

```json
{ "action": "top_pods", "namespace": "production", "sort_by": "cpu", "top_n": 10 }
```

#### 集群容量报告

```
生成集群容量报告
```

```json
{ "action": "capacity_report" }
```

### ConfigMap/Secret 管理

#### 查看 ConfigMap 数据

```
查看 app-config ConfigMap 的数据
```

```json
{ "action": "get_cm_data", "namespace": "default", "configmap_name": "app-config" }
```

#### 获取 Secret 数据

```
获取 db-credentials Secret 中的数据库密码
```

```json
{ "action": "get_secret_data", "namespace": "production", "secret_name": "db-credentials", "key": "password" }
```

### Ingress 管理

#### 列出 Ingress

```
列出 production 命名空间的所有 Ingress
```

```json
{ "action": "list", "namespace": "production" }
```

#### 查看路由规则

```
查看 api-ingress 的路由规则
```

```json
{ "action": "rules", "namespace": "default", "ingress_name": "api-ingress" }
```

### 命名空间管理

#### 资源摘要

```
查看 staging 命名空间的资源统计
```

```json
{ "action": "summary", "namespace": "staging" }
```

#### 资源配额

```
检查 production 命名空间的资源配额
```

```json
{ "action": "quota", "namespace": "production" }
```

### 端口转发

#### 创建端口转发

```
将本地 8080 端口转发到 postgres Pod 的 5432 端口
```

```json
{ "action": "create", "namespace": "default", "pod_name": "postgres-abc123", "local_port": 8080, "pod_port": 5432 }
```

#### 列出活跃转发

```
列出所有活跃的端口转发
```

```json
{ "action": "list" }
```

### 存储管理

#### 列出 PVC

```
列出 production 命名空间的所有 PVC
```

```json
{ "action": "list_pvc", "namespace": "production" }
```

#### 查找使用 PVC 的 Pod

```
查找哪些 Pod 正在使用 data-pvc 卷
```

```json
{ "action": "find_pods", "namespace": "default", "pvc_name": "data-pvc" }
```

#### 存储使用报告

```
生成存储使用报告
```

```json
{ "action": "usage_report" }
```

### 事件监控

#### 查看告警事件

```
查看 production 命名空间的 Warning 事件
```

```json
{ "action": "filter", "namespace": "production", "event_type": "Warning" }
```

#### 异常检测

```
检查 default 命名空间的异常
```

```json
{ "action": "anomaly", "namespace": "default", "warning_threshold": 5 }
```

#### 事件关联分析

```
关联分析 api-server Pod 的事件链
```

```json
{ "action": "correlate", "namespace": "production", "resource_kind": "Pod", "resource_name": "api-server-abc123" }
```

## 在 TOOLS.md 中配置

在 `~/.openclaw/workspace/TOOLS.md` 中添加集群特定的说明：

```markdown
### Kubernetes 集群

- **prod-k8s-01** (192.168.1.100)
  - Context: prod-cluster
  - 关键服务：order-service, payment-gateway
  - SLA: 99.99%

- **staging-k8s-01** (192.168.1.101)
  - Context: staging-cluster
  - 用于生产部署前的测试

### 常用操作

- 重启 order-service：namespace=production, label=app=order-service
- 检查支付网关：namespace=production, pod prefix=payment-gateway-
```

## Kubeconfig 设置

插件默认使用 `~/.kube/config`。确保已配置：

```bash
kubectl config get-contexts
kubectl config use-context <your-context>
```

## RBAC 权限

确保你的 kubeconfig 具有适当的 RBAC 权限：

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: openclaw-ops
rules:
  # Pod 操作 (k8s-pod, k8s-exec, k8s-logs, k8s-portforward)
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec"]
    verbs: ["get", "list", "watch", "create"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["delete"]  # 用于重启操作
  - apiGroups: [""]
    resources: ["pods/eviction"]
    verbs: ["create"]  # 用于节点驱逐
  # Deployment 操作 (k8s-deploy)
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "patch", "update"]
  # Node 操作 (k8s-node)
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "patch"]
  # Service 操作 (k8s-svc)
  - apiGroups: [""]
    resources: ["services", "endpoints"]
    verbs: ["get", "list"]
  # ConfigMap/Secret 操作 (k8s-config)
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list", "create", "delete"]
  # Ingress 操作 (k8s-ingress)
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "create", "update", "patch", "delete"]
  # 存储操作 (k8s-storage)
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["get", "list", "create", "patch", "delete"]
  - apiGroups: [""]
    resources: ["persistentvolumes"]
    verbs: ["get", "list"]
  - apiGroups: ["storage.k8s.io"]
    resources: ["storageclasses"]
    verbs: ["get", "list"]
  # 命名空间操作 (k8s-namespace)
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["get", "list", "create", "patch", "delete"]
  - apiGroups: [""]
    resources: ["resourcequotas", "limitranges"]
    verbs: ["get", "list", "create", "update"]
  # 事件操作 (k8s-events, k8s-event-analysis)
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list"]
  # 指标操作 (k8s-metrics)
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods", "nodes"]
    verbs: ["get", "list"]
```

## 开发

构建插件：

```bash
npm run build
```

运行测试：

```bash
npm test
```

## 安全提示

- **restart** 操作会删除 pods。在生产环境中谨慎使用。
- **delete namespace** 操作会删除命名空间中的所有资源，且不可逆。
- Secret 数据默认部分遮掩显示，需指定 `key` 参数才能获取完整值。
- PVC 删除可能导致数据丢失（取决于回收策略是否为 `Delete`）。
- 在破坏性操作前始终验证命名空间和资源名称。
- 考虑为生产环境操作实施审批工作流。

## 故障排查

### "Forbidden" 错误

检查 kubeconfig 中的 RBAC 权限。服务账号需要适当的角色。

### "Unable to connect to cluster"

验证 kubeconfig 路径和集群可访问性：

```bash
kubectl cluster-info
```

### "No resources found"

检查命名空间是否存在：

```bash
kubectl get namespaces
```

## 未来增强

- [ ] 支持多个 kubeconfig 文件
- [ ] 交互式 pod 选择（模糊搜索）
- [ ] 日志流式传输（实时 tail）
- [x] 资源指标集成（kubectl top）
- [x] ConfigMap/Secret 管理
- [x] 端口转发
- [x] PVC/PV/StorageClass 管理
- [x] 命名空间管理
- [x] Ingress 管理
- [x] HPA（水平自动扩缩容）管理
- [x] StatefulSet / DaemonSet / Job / CronJob 管理
- [x] RBAC / 网络策略 / 安全审计
- [x] Helm / Gateway API / 故障排查
- [x] 集群健康检查与拓扑分析
- [x] 成本分析与优化建议
- [x] SSH 主机系统监控
- [ ] 与 Prometheus 集成获取指标
- [ ] 告警集成（自动响应 pod 故障）

## 贡献

这个插件是你本地 OpenClaw 安装的一部分。根据你的基础设施需求自定义它。

## 学习资源

查看以下文档了解更多实践案例：

- [WEEK1-PRACTICE.md](WEEK1-PRACTICE.md) - 第一周学习实践记录
- [SCENARIOS.md](SCENARIOS.md) - 30+ 真实运维场景
- [REAL-WORLD-OPS.md](REAL-WORLD-OPS.md) - 生产环境运维案例
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - 常见问题排查手册

## License

MIT
