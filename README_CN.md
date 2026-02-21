# OpenClaw Kubernetes 插件

[English](README.md) | 简体中文

OpenClaw 的 Kubernetes 运维插件，提供 K8s 资源管理工具。

## 功能特性

### 当前 Skills

- **k8s-pod**: Pod 管理（列表、详情、日志、重启、状态）
- **k8s-deploy**: Deployment 管理（列表、详情、扩缩容、滚动更新状态/历史/重启/回滚、更新镜像）
- **k8s-node**: Node 管理（列表、详情、污点操作、标签管理、驱逐、封锁/解封）
- **k8s-svc**: Service 管理（列表、详情、端点查询、创建/删除、端口转发）

### 计划中的 Skills

- **k8s-logs**: 高级日志查询和聚合
- **k8s-metrics**: 资源指标和监控
- **k8s-events**: 事件监控和异常检测

## 安装

1. 安装依赖：

```bash
cd /Users/a123/.openclaw/extensions/k8s
npm install
```

2. 在 `openclaw.json` 中启用插件：

```json
{
  "plugins": {
    "entries": {
      "k8s": {
        "enabled": true
      }
    }
  }
}
```

3. （可选）配置自定义 kubeconfig：

```json
{
  "plugins": {
    "entries": {
      "k8s": {
        "enabled": true,
        "kubeconfigPath": "/custom/path/to/kubeconfig",
        "defaultContext": "prod-cluster"
      }
    }
  }
}
```

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

#### 端口转发

```
转发 redis-service 的 6379 端口到本地 6379
```

```json
{ "action": "port-forward", "namespace": "default", "service_name": "redis-service", "port": "6379:6379" }
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
kind: Role
metadata:
  name: openclaw-ops
  namespace: default
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["delete"]  # 用于重启操作
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch"]
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "patch"]
  - apiGroups: [""]
    resources: ["services"]
    verbs: ["get", "list", "create", "delete"]
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list"]
```

## 开发

构建插件：

```bash
npm run build
```

运行测试（待实现）：

```bash
npm test
```

## 安全提示

- **restart** 操作会删除 pods。在生产环境中谨慎使用。
- 在破坏性操作前始终验证命名空间和 pod 名称。
- 考虑为生产环境的重启操作实施审批工作流。
- 在 `logs/k8s-ops.log` 中审计所有操作（待实现）。

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
- [ ] 资源指标集成（kubectl top）
- [ ] ConfigMap/Secret 查看
- [ ] 进入容器执行命令
- [ ] 与 Prometheus 集成获取指标
- [ ] 告警集成（自动响应 pod 故障）
- [ ] HPA（水平自动扩缩容）管理
- [ ] PVC（持久卷声明）管理

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
