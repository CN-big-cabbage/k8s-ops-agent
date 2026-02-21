# 测试应用部署指南

## 🎯 目标

通过部署 Nginx 测试应用，验证 K8s 插件的各项功能。

---

## 📋 准备工作

### 1. 确认环境

在部署节点 (172.16.190.110) 执行：

```bash
# 检查集群状态
kubectl get nodes

# 检查是否有 development 命名空间
kubectl get ns development
```

### 2. 准备镜像（可选）

如果想使用 Harbor 私有镜像：

```bash
# 拉取官方镜像
docker pull nginx:1.21

# 打标签
docker tag nginx:1.21 harbor.myarchitect.online/apps/nginx:1.21

# 登录 Harbor
docker login harbor.myarchitect.online
# 用户名: admin
# 密码: 123456

# 推送到 Harbor
docker push harbor.myarchitect.online/apps/nginx:1.21
```

然后修改 `01-nginx-test.yaml` 中的镜像地址：
```yaml
image: harbor.myarchitect.online/apps/nginx:1.21
```

---

## 🚀 部署应用

### 方法 1: kubectl 命令行部署

```bash
# 应用配置
kubectl apply -f /Users/a123/.openclaw/extensions/k8s/examples/01-nginx-test.yaml

# 查看部署进度
kubectl get pods -n development -w
```

### 方法 2: 使用 OpenClaw Agent 部署

对 Agent 说：

```
"帮我部署 /Users/a123/.openclaw/extensions/k8s/examples/01-nginx-test.yaml"
```

或者手动 apply 后，让 Agent 监控：

```
"监控 development 命名空间的 nginx-test 部署进度"
```

---

## ✅ 验证部署

### 1. 检查 Deployment

**kubectl 命令**:
```bash
kubectl get deployment -n development
```

**使用 Agent**:
```
"列出 development 命名空间的所有 Deployment"
```

期望输出：
```
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
nginx-test   3/3     3            3           1m
```

### 2. 检查 Pod

**kubectl 命令**:
```bash
kubectl get pods -n development
```

**使用 Agent**:
```
"查看 development 命名空间的所有 Pod"
```

期望输出：
```
NAME                          READY   STATUS    RESTARTS   AGE
nginx-test-xxxxxxxxxx-xxxxx   1/1     Running   0          1m
nginx-test-xxxxxxxxxx-xxxxx   1/1     Running   0          1m
nginx-test-xxxxxxxxxx-xxxxx   1/1     Running   0          1m
```

### 3. 检查 Service

**kubectl 命令**:
```bash
kubectl get svc -n development
```

**使用 Agent**:
```
"列出 development 的 Service"
```

### 4. 访问测试

**方法 A: 通过 NodePort 访问**

在浏览器打开：
```
http://172.16.190.111:30080
http://172.16.190.112:30080
http://172.16.190.113:30080
```

**方法 B: 在集群内测试**

```bash
# 创建测试 Pod
kubectl run test-pod --rm -it --image=busybox --namespace=development -- sh

# 在 Pod 内执行
wget -O- http://nginx-test.development.svc.cluster.local
```

**方法 C: 端口转发**

```bash
kubectl port-forward -n development svc/nginx-test 8080:80

# 然后访问 http://localhost:8080
```

---

## 🧪 测试插件功能

### 测试 1: Pod 管理

```
# 列出 Pod
"列出 development 命名空间的所有 Pod"

# 查看 Pod 详情
"查看 nginx-test-xxx 这个 Pod 的详细信息"

# 查看日志
"显示 nginx-test-xxx 的日志"

# 检查状态
"nginx-test-xxx 的状态如何？"
```

### 测试 2: Deployment 管理

```
# 查看 Deployment
"查看 nginx-test 部署的详细信息"

# 扩容
"把 nginx-test 扩容到 5 个副本"

# 检查扩容结果
"nginx-test 的滚动更新状态"

# 缩容
"把 nginx-test 缩回 3 个副本"
```

### 测试 3: 滚动更新

```
# 更新镜像
"更新 development 的 nginx-test 部署，镜像改为 nginx:1.22"

# 监控更新
"nginx-test 的滚动更新进度如何？"

# 查看 Pod 变化
"列出 development 的 Pod，看看有没有新 Pod"
```

### 测试 4: 查看历史

```
# 查看部署历史
"显示 nginx-test 的部署历史"
```

### 测试 5: 回滚

```
# 回滚到上个版本
"回滚 nginx-test 到上一个版本"

# 验证回滚
"nginx-test 现在用的是什么镜像？"
```

### 测试 6: 重启

```
# 滚动重启
"重启 nginx-test 部署"

# 查看重启后的 Pod
"nginx-test 的所有 Pod 都重启好了吗？"
```

### 测试 7: 故障排查模拟

**模拟镜像拉取失败**:

```bash
# 手动编辑 Deployment，使用不存在的镜像
kubectl set image deployment/nginx-test nginx=nginx:nonexistent -n development
```

然后让 Agent 排查：

```
"nginx-test 部署好像有问题，帮我看看"
```

Agent 会：
1. 检查 Deployment 状态
2. 列出 Pod（发现 ImagePullBackOff）
3. 查看 Pod 详情和事件
4. 给出诊断结果

**恢复**:
```
"回滚 nginx-test 到正常版本"
```

---

## 🎯 进阶测试

### 测试 8: 资源限制测试

```bash
# 修改资源限制，触发 OOMKilled
kubectl set resources deployment nginx-test --limits=memory=10Mi -n development
```

让 Agent 发现问题：

```
"检查 development 的 Pod，有异常吗？"
```

### 测试 9: 标签筛选

```
"列出 development 命名空间中 app=nginx-test 的所有 Pod"
```

### 测试 10: 多命名空间查询

```
"显示所有命名空间的 Pod"
```

---

## 🧹 清理测试环境

### 删除应用

```bash
kubectl delete -f /Users/a123/.openclaw/extensions/k8s/examples/01-nginx-test.yaml
```

### 保留命名空间（用于后续测试）

```bash
# 只删除应用，保留 development 命名空间
kubectl delete deployment,svc,configmap -n development --all
```

---

## 📊 测试清单

完成以下测试后，打勾 ✅：

- [ ] 成功部署 nginx-test
- [ ] 验证 3 个 Pod 都在 Running
- [ ] 通过 NodePort 访问成功
- [ ] Agent 能正确列出 Pod
- [ ] Agent 能查看 Pod 详情和日志
- [ ] Agent 能扩缩容 Deployment
- [ ] Agent 能更新镜像并监控滚动更新
- [ ] Agent 能查看部署历史
- [ ] Agent 能回滚 Deployment
- [ ] Agent 能排查镜像拉取失败问题
- [ ] Agent 能发现 OOMKilled 问题

---

## 💡 学习要点

### 1. Pod 生命周期

观察 Pod 从创建到 Running 的过程：
- Pending → ContainerCreating → Running

### 2. 滚动更新策略

理解 RollingUpdate 参数：
- `maxSurge`: 最多超出期望副本数的 Pod 数量
- `maxUnavailable`: 最多不可用的 Pod 数量

### 3. 健康检查

- `livenessProbe`: 存活探针（失败会重启容器）
- `readinessProbe`: 就绪探针（失败会从 Service 移除）

### 4. 资源管理

- `requests`: 调度时保证的资源
- `limits`: 运行时的资源上限

---

## 🐛 常见问题

### 问题 1: Pod 一直 Pending

**排查**:
```
"为什么 nginx-test 的 Pod 是 Pending 状态？"
```

可能原因：
- 节点资源不足
- 镜像拉取中
- 调度策略限制

### 问题 2: ImagePullBackOff

**排查**:
```
"nginx-test 的 Pod 拉取镜像失败了"
```

解决方案：
- 检查镜像名称是否正确
- 检查 Harbor 是否可访问
- 检查节点 /etc/hosts 配置

### 问题 3: CrashLoopBackOff

**排查**:
```
"nginx-test 的 Pod 一直崩溃重启"
```

查看日志：
```
"显示 nginx-test-xxx 的 previous 日志"
```

---

**测试愉快！有问题随时问 Agent！** 🎉
