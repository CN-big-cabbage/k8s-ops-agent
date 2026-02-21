# 真实环境运维指南

基于您的 K8s 集群环境（kubeasz 1.34.1 二进制部署）的实战运维手册。

---

## 🏗️ 您的集群架构

```
┌──────────────────────────────────────────┐
│  VIP: 172.16.190.100 (Keepalived)        │
│  ├─ HAProxy-1: 172.16.190.109 (MASTER)   │
│  └─ HAProxy-2: 172.16.190.110 (BACKUP)   │
└──────────────────┬───────────────────────┘
                   │
       ┌───────────┴───────────┐
       │   K8s API Server      │
       │   (3 Masters HA)      │
       └───────────┬───────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
┌───▼────┐   ┌────▼───┐   ┌─────▼──┐
│Master1 │   │Master2 │   │Master3 │
│ .101   │   │ .102   │   │ .103   │
└────────┘   └────────┘   └────────┘
                   │
         ┌─────────┴─────────┐
         │   Etcd Cluster    │
         │   (独立部署)       │
         └─────────┬─────────┘
              ┌────┼────┐
          ┌───▼──┐ │ ┌──▼───┐
          │Etcd1 │ │ │Etcd3 │
          │ .106 │ │ │ .108 │
          └──────┘ │ └──────┘
              ┌────▼──┐
              │Etcd2  │
              │ .107  │
              └───────┘
                   │
         ┌─────────┴─────────┐
         │   Worker Nodes    │
         └─────────┬─────────┘
    ┌──────────────┼──────────────┐
┌───▼────┐   ┌────▼───┐   ┌─────▼──┐
│ Node1  │   │ Node2  │   │ Node3  │
│ .111   │   │ .112   │   │ .113   │
└────────┘   └────────┘   └────────┘
                   │
         ┌─────────┴─────────┐
         │  Harbor Registry  │
         └─────────┬─────────┘
              ┌────┼────┐
          ┌───▼───┐ ┌──▼────┐
          │Harbor1│ │Harbor2│
          │ .104  │ │ .105  │
          └───────┘ └───────┘
```

---

## 📋 日常运维场景

### 场景 1: 每日晨检（推荐每天 9:00）

**目标**: 确保集群健康运行，提前发现隐患

#### 手动执行版本

在部署节点 (172.16.190.110) SSH 登录后：

```bash
# 1. 检查所有节点状态
kubectl get nodes -o wide

# 2. 检查系统 Pod
kubectl get pods -n kube-system

# 3. 检查 Etcd 集群健康
export NODE_IPS="172.16.190.106 172.16.190.107 172.16.190.108"
for ip in ${NODE_IPS}; do
  /usr/local/bin/etcdctl \
    --endpoints=https://${ip}:2379 \
    --cacert=/etc/kubernetes/ssl/ca.pem \
    --cert=/etc/kubernetes/ssl/etcd.pem \
    --key=/etc/kubernetes/ssl/etcd-key.pem \
    endpoint health
done

# 4. 检查 HAProxy 和 Keepalived
ssh 172.16.190.109 "systemctl status haproxy keepalived | grep Active"
ssh 172.16.190.110 "ip a | grep 172.16.190.100"  # 检查 VIP

# 5. 检查 Harbor
curl -k https://harbor.myarchitect.online/api/v2.0/health
```

#### Agent 自动化版本

对 OpenClaw Agent 说：

```
"执行 K8s 集群晨检"
```

Agent 会自动：
1. 调用 `k8s_pod` 检查所有节点状态
2. 列出 kube-system 的 Pod
3. 识别异常 Pod（CrashLoopBackOff、Pending 等）
4. 生成健康报告并发送到飞书

---

### 场景 2: 部署应用到集群

#### 步骤 1: 准备镜像（在部署节点）

```bash
# 1. 拉取或构建镜像
docker pull nginx:1.21

# 2. 打标签
docker tag nginx:1.21 harbor.myarchitect.online/apps/nginx:1.21

# 3. 推送到 Harbor
docker login harbor.myarchitect.online  # admin/123456
docker push harbor.myarchitect.online/apps/nginx:1.21
```

#### 步骤 2: 创建 Deployment

创建 `nginx-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-web
  namespace: development  # 学习环境使用 development
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx-web
  template:
    metadata:
      labels:
        app: nginx-web
    spec:
      containers:
      - name: nginx
        image: harbor.myarchitect.online/apps/nginx:1.21
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 200m
            memory: 256Mi
```

部署:

```bash
kubectl create ns development
kubectl apply -f nginx-deployment.yaml
```

#### 步骤 3: 使用 Agent 监控部署

对 Agent 说：

```
"部署了 nginx-web，帮我监控部署进度"
```

Agent 会：
1. 检查 Deployment 状态: `k8s_deploy` → `rollout_status`
2. 列出相关 Pod: `k8s_pod` → `list` (label: app=nginx-web)
3. 实时报告进度直到所有副本 Ready

---

### 场景 3: 应用更新与回滚

#### 更新镜像

对 Agent 说：

```
"把 development 命名空间的 nginx-web 部署更新到 nginx:1.22"
```

Agent 会执行：
```json
{
  "action": "update_image",
  "namespace": "development",
  "deployment_name": "nginx-web",
  "container": "nginx",
  "image": "harbor.myarchitect.online/apps/nginx:1.22"
}
```

然后自动监控滚动更新进度。

#### 发现问题，立即回滚

```
"刚才的更新有问题，立即回滚 nginx-web"
```

Agent 会：
1. 查看历史: `rollout_history`
2. 执行回滚: `rollout_undo`
3. 监控回滚进度
4. 确认所有 Pod 恢复健康

---

### 场景 4: 扩缩容应对流量

#### 临时扩容

对 Agent 说：

```
"nginx-web 流量增加了，扩容到 10 个副本"
```

Agent 执行：
```json
{
  "action": "scale",
  "namespace": "development",
  "deployment_name": "nginx-web",
  "replicas": 10
}
```

#### 流量下降，缩容节省资源

```
"流量正常了，把 nginx-web 缩回 3 个副本"
```

---

### 场景 5: Pod 故障排查

#### 发现问题

```
"development 命名空间有个 Pod 一直重启，帮我看看"
```

Agent 会：
1. 列出所有 Pod: `k8s_pod` → `list` (namespace: development)
2. 识别高重启次数的 Pod
3. 查看 Pod 状态: `status`
4. 获取日志: `logs` (包括 previous 日志)
5. 描述 Pod 查看事件: `describe`
6. 诊断问题并给出建议

#### 典型问题示例

**问题 1: OOMKilled**
```
Agent 发现: 容器超过内存限制被杀
建议: "增加 Memory Limit 到 512Mi" 或 "检查应用内存泄漏"
```

**问题 2: ImagePullBackOff**
```
Agent 发现: 镜像拉取失败
建议:
1. 检查镜像是否存在于 Harbor
2. 检查节点是否配置了 Harbor 域名解析
3. 检查 containerd 配置
```

**问题 3: CrashLoopBackOff**
```
Agent 发现: 应用启动失败
操作: 自动查看 previous logs 找到错误原因
建议: 根据错误日志给出修复方案
```

---

### 场景 6: 节点维护

#### 节点下线维护

对 Agent 说：

```
"我要维护 k8s-node2，帮我安全地驱逐 Pod"
```

Agent 会建议执行：

```bash
# 1. 标记节点不可调度
kubectl cordon k8s-node2

# 2. 驱逐 Pod（保留守护进程）
kubectl drain k8s-node2 --ignore-daemonsets --delete-emptydir-data

# 3. 此时可以安全地维护节点（重启、升级等）
ssh 172.16.190.112 "reboot"

# 4. 维护完成后，恢复调度
kubectl uncordon k8s-node2
```

#### 新增节点

在部署节点执行：

```bash
cd /etc/kubeasz
./ezctl add-node k8s-cluster1 172.16.190.114 k8s_nodename="k8s-node4"
```

然后对 Agent 说：

```
"检查新节点 k8s-node4 是否正常加入集群"
```

Agent 会验证：
- 节点状态是否 Ready
- Calico Pod 是否运行
- kube-proxy 是否运行

---

## 🤖 自动化巡检配置

### Cron 定时任务

编辑 `~/.openclaw/cron/jobs.json`:

```json
{
  "k8s-morning-check": {
    "schedule": "0 9 * * *",
    "prompt": "执行 K8s 集群晨检：1) 检查所有节点状态 2) 检查 Etcd 健康 3) 检查系统 Pod 4) 统计异常 Pod 5) 生成报告发送到飞书",
    "deliveryQueue": ["feishu:ops-group"]
  },
  "k8s-etcd-backup": {
    "schedule": "0 2 * * *",
    "prompt": "在部署节点执行 Etcd 备份：cd /etc/kubeasz && ./ezctl backup k8s-cluster1。完成后记录到 memory/backup-log.md",
    "deliveryQueue": []
  },
  "k8s-cert-check": {
    "schedule": "0 10 1 * *",
    "prompt": "检查 K8s 证书有效期，如果少于 30 天，发送告警到飞书",
    "deliveryQueue": ["feishu:ops-group"]
  },
  "k8s-weekly-report": {
    "schedule": "0 10 * * 1",
    "prompt": "生成上周 K8s 运维周报：1) Deployment 变更记录 2) Pod 重启统计 3) 节点资源使用趋势 4) 重要事件回顾。发送到飞书",
    "deliveryQueue": ["feishu:management"]
  }
}
```

### Heartbeat 实时监控

`~/.openclaw/workspace/HEARTBEAT.md` 已配置，Agent 会每 30 分钟自动检查：
- Master 节点状态
- Etcd 集群健康
- HAProxy VIP 状态
- 异常 Pod

---

## 📚 学习路线与实践

### 第 1 周: 基础操作熟悉

**目标**: 熟悉 kubectl 和 Agent 操作

**实践任务**:
1. 部署一个简单的 Nginx 应用
2. 练习扩缩容
3. 练习滚动更新和回滚
4. 模拟 Pod 故障并排查

**与 Agent 对话示例**:
```
"在 development 命名空间部署一个 3 副本的 Nginx"
"扩容到 5 个副本"
"更新到 nginx:1.22"
"查看部署历史"
"回滚到上个版本"
```

### 第 2 周: 存储与配置

**目标**: 掌握 ConfigMap、Secret、PV/PVC

**实践任务**:
1. 创建 ConfigMap 存储应用配置
2. 创建 Secret 存储敏感信息
3. 配置 PVC 挂载持久化存储

**与 Agent 对话示例**:
```
"帮我检查 development 命名空间的 ConfigMap"
"查看 mysql 的 Secret 是否正确挂载"
```

### 第 3 周: 网络与服务

**目标**: 理解 Service、Ingress

**实践任务**:
1. 创建 ClusterIP Service
2. 创建 NodePort Service 对外暴露
3. 配置 Ingress 域名访问

**与 Agent 对话示例**:
```
"列出 development 的所有 Service"
"nginx-web 的 Service 端点是什么？"
```

### 第 4 周: 监控与日志

**目标**: 部署 Prometheus + Grafana

**实践任务**:
1. 部署 Prometheus Operator
2. 配置 Grafana Dashboard
3. 查看应用 Metrics

**与 Agent 对话示例**:
```
"monitoring 命名空间的 Prometheus Pod 状态"
"Grafana 的 Pod 日志最近有错误吗？"
```

---

## 🚨 常见问题与解决方案

### 问题 1: Harbor 证书信任问题

**现象**: containerd 拉取 Harbor 镜像失败

**解决**:
```bash
# 在每个节点执行
mkdir -p /etc/containerd/certs.d/harbor.myarchitect.online
cat > /etc/containerd/certs.d/harbor.myarchitect.online/hosts.toml << EOF
server = "https://harbor.myarchitect.online"
[host."https://harbor.myarchitect.online"]
  skip_verify = true
EOF

systemctl restart containerd
```

### 问题 2: Calico Pod 异常

**现象**: 节点之间 Pod 网络不通

**排查**:
```bash
# 检查 Calico 状态
kubectl get pods -n kube-system | grep calico

# 查看 Calico 日志
kubectl logs -n kube-system calico-node-xxx

# 检查节点路由
ip route
```

### 问题 3: Etcd 空间不足

**现象**: Etcd 报警存储空间不足

**解决**:
```bash
# 压缩历史数据
ETCDCTL_API=3 etcdctl \
  --endpoints=https://172.16.190.106:2379 \
  --cacert=/etc/kubernetes/ssl/ca.pem \
  --cert=/etc/kubernetes/ssl/etcd.pem \
  --key=/etc/kubernetes/ssl/etcd-key.pem \
  compact $(etcdctl --endpoints=... endpoint status --write-out="json" | jq '.[0].Status.header.revision')

# 整理碎片
ETCDCTL_API=3 etcdctl \
  --endpoints=https://172.16.190.106:2379 \
  --cacert=/etc/kubernetes/ssl/ca.pem \
  --cert=/etc/kubernetes/ssl/etcd.pem \
  --key=/etc/kubernetes/ssl/etcd-key.pem \
  defrag
```

---

## 🎯 下一步计划

### 短期目标（1-2 周）
1. ✅ 熟悉 k8s-pod 和 k8s-deploy skills
2. ✅ 配置 TOOLS.md 和 HEARTBEAT.md
3. 🔲 部署第一个测试应用
4. 🔲 配置 Cron 自动巡检

### 中期目标（1 个月）
1. 🔲 添加 k8s-node skill（节点管理）
2. 🔲 添加 k8s-svc skill（Service/Ingress 管理）
3. 🔲 集成 Prometheus 监控
4. 🔲 配置告警自动处置

### 长期目标（3 个月）
1. 🔲 完整的 GitOps 流程
2. 🔲 CI/CD 集成
3. 🔲 多集群管理
4. 🔲 灾难恢复演练

---

**祝学习顺利！一起成长！** 🚀
