# 第一周实践指南

手把手完成本周 3 个任务，验证 K8s 运维 Agent 的所有功能。

预计时间：**1-2 小时**

---

## 📋 任务清单

- [ ] **任务 1**: 部署测试应用验证功能 (30 分钟)
- [ ] **任务 2**: 测试所有 4 个 Skills (40 分钟)
- [ ] **任务 3**: 配置飞书告警 (20 分钟)

---

## 🎯 任务 1: 部署测试应用 (30 分钟)

### 步骤 1.1: 准备环境

**在部署节点登录** (172.16.190.110):

```bash
# SSH 登录
ssh root@172.16.190.110

# 验证 kubectl 可用
kubectl get nodes
```

**期望输出**:
```
NAME          STATUS   ROLES    AGE   VERSION
k8s-master1   Ready    master   Xd    v1.34.1
k8s-master2   Ready    master   Xd    v1.34.1
k8s-master3   Ready    master   Xd    v1.34.1
k8s-node1     Ready    <none>   Xd    v1.34.1
k8s-node2     Ready    <none>   Xd    v1.34.1
k8s-node3     Ready    <none>   Xd    v1.34.1
```

✅ **检查点**: 6 个节点都是 Ready 状态

---

### 步骤 1.2: 创建测试应用配置文件

在部署节点创建文件:

```bash
# 创建目录
mkdir -p ~/k8s-test

# 创建配置文件
cat > ~/k8s-test/nginx-test.yaml << 'EOF'
# =====================================================
# Nginx 测试应用
# =====================================================

---
# 创建命名空间
apiVersion: v1
kind: Namespace
metadata:
  name: development
  labels:
    environment: development

---
# ConfigMap - 自定义网页
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-config
  namespace: development
data:
  index.html: |
    <!DOCTYPE html>
    <html>
    <head>
        <title>K8s Test - OpenClaw</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
            }
            .container {
                text-align: center;
                background: rgba(255,255,255,0.1);
                padding: 40px;
                border-radius: 10px;
            }
            h1 { font-size: 3em; margin: 0; }
            p { font-size: 1.2em; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 OpenClaw K8s</h1>
            <p>测试应用运行成功！</p>
            <p>Pod: <span id="hostname"></span></p>
        </div>
        <script>
            document.getElementById('hostname').textContent = window.location.hostname;
        </script>
    </body>
    </html>

---
# Deployment - 3 副本
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-test
  namespace: development
  labels:
    app: nginx-test
  annotations:
    kubernetes.io/change-cause: "Initial deployment"
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: nginx-test
  template:
    metadata:
      labels:
        app: nginx-test
    spec:
      containers:
      - name: nginx
        image: nginx:1.21
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 200m
            memory: 256Mi
        volumeMounts:
        - name: nginx-config
          mountPath: /usr/share/nginx/html
          readOnly: true
        livenessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /
            port: 80
          initialDelaySeconds: 5
          periodSeconds: 5
      volumes:
      - name: nginx-config
        configMap:
          name: nginx-config

---
# Service - ClusterIP
apiVersion: v1
kind: Service
metadata:
  name: nginx-test
  namespace: development
spec:
  type: ClusterIP
  selector:
    app: nginx-test
  ports:
  - port: 80
    targetPort: 80

---
# Service - NodePort (外部访问)
apiVersion: v1
kind: Service
metadata:
  name: nginx-test-nodeport
  namespace: development
spec:
  type: NodePort
  selector:
    app: nginx-test
  ports:
  - port: 80
    targetPort: 80
    nodePort: 30080
EOF
```

✅ **检查点**: 文件创建成功

---

### 步骤 1.3: 部署应用

```bash
# 应用配置
kubectl apply -f ~/k8s-test/nginx-test.yaml

# 查看部署进度
kubectl get pods -n development -w
```

**期望输出** (按 Ctrl+C 停止 watch):
```
NAME                          READY   STATUS              RESTARTS   AGE
nginx-test-xxxxxxxxxx-xxxxx   0/1     ContainerCreating   0          5s
nginx-test-xxxxxxxxxx-xxxxx   0/1     ContainerCreating   0          5s
nginx-test-xxxxxxxxxx-xxxxx   0/1     ContainerCreating   0          5s
nginx-test-xxxxxxxxxx-xxxxx   1/1     Running             0          15s
nginx-test-xxxxxxxxxx-xxxxx   1/1     Running             0          17s
nginx-test-xxxxxxxxxx-xxxxx   1/1     Running             0          20s
```

✅ **检查点**: 3 个 Pod 都变成 Running, READY 1/1

---

### 步骤 1.4: 验证部署

```bash
# 检查 Deployment
kubectl get deployment -n development

# 检查 Service
kubectl get svc -n development

# 检查 Pod 详情
kubectl get pods -n development -o wide
```

**期望输出**:
```
# Deployment
NAME         READY   UP-TO-DATE   AVAILABLE   AGE
nginx-test   3/3     3            3           1m

# Service
NAME                  TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)        AGE
nginx-test            ClusterIP   10.100.x.x      <none>        80/TCP         1m
nginx-test-nodeport   NodePort    10.100.y.y      <none>        80:30080/TCP   1m

# Pods
NAME                          READY   STATUS    RESTARTS   AGE   IP              NODE
nginx-test-xxx-xxx            1/1     Running   0          1m    10.200.x.x      k8s-node1
nginx-test-xxx-xxx            1/1     Running   0          1m    10.200.y.y      k8s-node2
nginx-test-xxx-xxx            1/1     Running   0          1m    10.200.z.z      k8s-node3
```

✅ **检查点**:
- Deployment 显示 3/3 Ready
- 有 2 个 Service
- 3 个 Pod 分布在不同节点

---

### 步骤 1.5: 访问测试

**方法 1: 通过 NodePort 访问**

在浏览器打开（选择任意一个节点 IP）:
- http://172.16.190.111:30080
- http://172.16.190.112:30080
- http://172.16.190.113:30080

**期望**: 看到紫色渐变背景的网页，显示 "🚀 OpenClaw K8s"

**方法 2: 在集群内测试**

```bash
# 从部署节点访问 ClusterIP
CLUSTER_IP=$(kubectl get svc nginx-test -n development -o jsonpath='{.spec.clusterIP}')
curl http://$CLUSTER_IP
```

**期望输出**: 返回 HTML 内容

**方法 3: 端口转发测试**

```bash
# 端口转发（在部署节点）
kubectl port-forward -n development svc/nginx-test 8080:80

# 新开一个终端测试
curl http://localhost:8080
```

✅ **检查点**: 能成功访问网页

---

### 🎉 任务 1 完成标志

- [x] 6 个节点都是 Ready
- [x] development 命名空间创建成功
- [x] 3 个 nginx-test Pod 都在 Running
- [x] 通过 NodePort 能访问到网页
- [x] 网页显示正常（紫色背景）

**如果遇到问题，跳转到 [故障排查](#故障排查-任务-1)**

---

## 🧪 任务 2: 测试所有 Skills (40 分钟)

现在我们通过 OpenClaw Agent 来测试所有功能。

### 前置条件

确保 OpenClaw 正在运行，并且已启用 k8s 插件。

---

### 测试 2.1: k8s-pod Skill (10 分钟)

#### 测试 1: 列出 Pod

**对 Agent 说**:
```
列出 development 命名空间的所有 Pod
```

**期望响应**:
```
NAMESPACE     NAME                          READY  STATUS   RESTARTS  AGE   NODE
development   nginx-test-xxxxxxxxxx-xxxxx   1/1    Running  0         5m    k8s-node1
development   nginx-test-xxxxxxxxxx-xxxxx   1/1    Running  0         5m    k8s-node2
development   nginx-test-xxxxxxxxxx-xxxxx   1/1    Running  0         5m    k8s-node3
```

✅ **检查点**: Agent 正确列出 3 个 Pod

---

#### 测试 2: 查看 Pod 详情

**对 Agent 说** (替换为实际 Pod 名):
```
查看 nginx-test-xxxxxxxxxx-xxxxx 这个 Pod 的详细信息
```

**期望响应**: 包含以下信息
- Pod 名称和命名空间
- 容器状态 (Running)
- 资源限制 (CPU: 100m-200m, Memory: 128Mi-256Mi)
- 重启次数
- Events

✅ **检查点**: Agent 显示完整的 Pod 详情

---

#### 测试 3: 查看 Pod 日志

**对 Agent 说**:
```
显示 nginx-test-xxxxxxxxxx-xxxxx 的日志，最近 20 行
```

**期望响应**:
```
(Nginx 访问日志)
172.16.190.110 - - [21/Feb/2026:12:00:00 +0000] "GET / HTTP/1.1" 200 ...
...
```

✅ **检查点**: Agent 返回日志内容

---

#### 测试 4: 检查 Pod 状态

**对 Agent 说**:
```
nginx-test 的所有 Pod 状态如何？
```

**期望响应**:
```
Pod: development/nginx-test-xxx
Status: Running
Ready: 1/1
Restarts: 0
Conditions: Ready=True, ContainersReady=True
...
```

✅ **检查点**: 显示 3 个 Pod 都健康

---

### 测试 2.2: k8s-deploy Skill (10 分钟)

#### 测试 5: 查看 Deployment

**对 Agent 说**:
```
列出 development 命名空间的所有 Deployment
```

**期望响应**:
```
NAMESPACE     NAME         READY  UP-TO-DATE  AVAILABLE  AGE
development   nginx-test   3/3    3           3          10m
```

✅ **检查点**: 显示 nginx-test deployment

---

#### 测试 6: 扩容测试

**对 Agent 说**:
```
把 development 的 nginx-test 扩容到 5 个副本
```

**期望响应**:
```
Deployment development/nginx-test scaled to 5 replicas
```

**验证**:
```bash
# 在部署节点执行
kubectl get pods -n development
```

应该看到 5 个 Pod

✅ **检查点**: 成功扩容到 5 个副本

---

#### 测试 7: 查看部署状态

**对 Agent 说**:
```
nginx-test 的滚动更新状态
```

**期望响应**:
```
Deployment: development/nginx-test
Replicas: 5/5 (updated: 5, available: 5)

Progressing: True
  Reason: NewReplicaSetAvailable
  Message: ...

✓ Rollout completed successfully
```

✅ **检查点**: 显示 5/5 ready

---

#### 测试 8: 缩容

**对 Agent 说**:
```
把 nginx-test 缩回 3 个副本
```

**验证**:
```bash
kubectl get deployment nginx-test -n development
```

应该显示 3/3

✅ **检查点**: 缩容成功

---

#### 测试 9: 更新镜像

**对 Agent 说**:
```
更新 development 的 nginx-test 部署，容器 nginx 的镜像改为 nginx:1.22
```

**期望响应**:
```
Deployment development/nginx-test updated: nginx image set to nginx:1.22
```

**验证**: 观察 Pod 滚动更新
```bash
kubectl get pods -n development -w
```

应该看到：
- 旧 Pod 逐渐 Terminating
- 新 Pod 逐渐 Running

✅ **检查点**: 镜像更新成功，Pod 滚动重启

---

#### 测试 10: 查看部署历史

**对 Agent 说**:
```
显示 nginx-test 的部署历史
```

**期望响应**:
```
Deployment: development/nginx-test
Rollout History:

REVISION  CHANGE-CAUSE
1         Initial deployment
2         (none)
```

✅ **检查点**: 显示至少 2 个版本

---

#### 测试 11: 回滚

**对 Agent 说**:
```
回滚 development 的 nginx-test 到上一个版本
```

**期望响应**:
```
Deployment development/nginx-test rolled back to revision 1
```

**验证**:
```bash
kubectl get pods -n development -o jsonpath='{.items[0].spec.containers[0].image}'
```

应该显示 `nginx:1.21`

✅ **检查点**: 成功回滚到 nginx:1.21

---

### 测试 2.3: k8s-node Skill (10 分钟)

#### 测试 12: 列出节点

**对 Agent 说**:
```
列出所有节点
```

**期望响应**:
```
NAME          STATUS  ROLES     AGE   VERSION
k8s-master1   Ready   master    Xd    v1.34.1
k8s-master2   Ready   master    Xd    v1.34.1
k8s-master3   Ready   master    Xd    v1.34.1
k8s-node1     Ready   <none>    Xd    v1.34.1
k8s-node2     Ready   <none>    Xd    v1.34.1
k8s-node3     Ready   <none>    Xd    v1.34.1
```

✅ **检查点**: 显示 6 个节点

---

#### 测试 13: 查看节点详情

**对 Agent 说**:
```
k8s-node1 的详细信息
```

**期望响应**: 包含
- 节点状态 (Ready)
- 资源容量 (CPU, Memory, Pods)
- 系统信息 (OS, Kernel, Container Runtime)
- 节点上的 Pod 列表

✅ **检查点**: 显示完整节点信息

---

#### 测试 14: 节点状态

**对 Agent 说**:
```
k8s-master1 的状态如何？
```

**期望响应**:
```
Node: k8s-master1

--- Conditions ---
  ✓ Ready: True
  ✓ MemoryPressure: False
  ✓ DiskPressure: False
  ✓ PIDPressure: False
  ✓ NetworkUnavailable: False

Schedulable: Yes

--- Resource Capacity ---
  CPU: 4
  Memory: 8Gi
  Pods: 110

--- Allocatable ---
  CPU: 4
  Memory: 7.8Gi
  Pods: 110
```

✅ **检查点**: 显示节点健康

---

#### 测试 15: Cordon 节点 (仅模拟，不实际执行)

**对 Agent 说**:
```
标记 k8s-node3 为不可调度
```

**期望响应**:
```
Node k8s-node3 cordoned (marked as unschedulable)
```

**验证**:
```bash
kubectl get nodes
```

k8s-node3 应该显示 `SchedulingDisabled`

**恢复**:
```
标记 k8s-node3 为可调度
```

✅ **检查点**: Cordon 和 Uncordon 成功

---

### 测试 2.4: k8s-svc Skill (10 分钟)

#### 测试 16: 列出 Service

**对 Agent 说**:
```
列出 development 命名空间的所有 Service
```

**期望响应**:
```
NAMESPACE     NAME                  TYPE        CLUSTER-IP    EXTERNAL-IP  PORT(S)         AGE
development   nginx-test            ClusterIP   10.100.x.x    <none>       80/TCP          15m
development   nginx-test-nodeport   NodePort    10.100.y.y    <none>       80:30080/TCP    15m
```

✅ **检查点**: 显示 2 个 Service

---

#### 测试 17: Service 详情

**对 Agent 说**:
```
查看 development 的 nginx-test service 详细信息
```

**期望响应**: 包含
- Service 类型 (ClusterIP)
- Cluster IP
- Selector (app=nginx-test)
- Endpoints (3 个 Pod IP)

✅ **检查点**: 显示完整 Service 信息

---

#### 测试 18: 查看端点

**对 Agent 说**:
```
nginx-test service 的端点是什么？
```

**期望响应**:
```
Endpoints for development/nginx-test:

Ready Endpoints (3):
  10.200.x.x → nginx-test-xxx [http:80]
  10.200.y.y → nginx-test-xxx [http:80]
  10.200.z.z → nginx-test-xxx [http:80]
```

✅ **检查点**: 显示 3 个健康端点

---

#### 测试 19: Service 状态

**对 Agent 说**:
```
nginx-test-nodeport service 的状态
```

**期望响应**:
```
Service: development/nginx-test-nodeport
Type: NodePort
Cluster IP: 10.100.x.x

Ports:
  http: 80/TCP → 80 (NodePort: 30080)

Endpoints: 3
```

✅ **检查点**: 显示 NodePort 配置

---

### 🎉 任务 2 完成标志

- [x] k8s-pod: 4 个测试全部通过
- [x] k8s-deploy: 7 个测试全部通过
- [x] k8s-node: 4 个测试全部通过
- [x] k8s-svc: 4 个测试全部通过
- [x] **总计**: 19 个测试全部成功

**如果遇到问题，跳转到 [故障排查](#故障排查-任务-2)**

---

## 📢 任务 3: 配置飞书告警 (20 分钟)

### 步骤 3.1: 创建飞书运维群

1. **打开飞书客户端**

2. **创建新群聊**
   - 点击 "+" → "创建群聊"
   - 群名称: "K8s 运维群"
   - 添加成员（可选）

3. **添加机器人**
   - 点击群设置 → "群机器人"
   - 找到您的 OpenClaw 机器人
   - 点击"添加"

✅ **检查点**: 机器人已在群内

---

### 步骤 3.2: 获取群组 ID

**方法 1: 通过飞书开放平台**

1. 登录 https://open.feishu.cn/
2. 进入您的应用（cli_a913a13426789bd3）
3. 左侧菜单 → "群组管理"
4. 找到 "K8s 运维群"
5. 复制群 ID（格式: `oc_xxxxxxxxxxxxxx`）

**方法 2: 通过 API 调用**

在部署节点执行:

```bash
# 使用飞书 API 获取机器人所在的群列表
curl -X GET \
  "https://open.feishu.cn/open-apis/im/v1/chats?page_size=20" \
  -H "Authorization: Bearer YOUR_APP_ACCESS_TOKEN"
```

（需要先获取 app_access_token）

✅ **检查点**: 获得群 ID，类似 `oc_a1b2c3d4e5f6`

---

### 步骤 3.3: 配置 OpenClaw

编辑配置文件:

```bash
# 在运行 OpenClaw 的机器上
vi ~/.openclaw/openclaw.json
```

找到 `channels.feishu` 部分，添加 groups:

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "accounts": {
        "main": {
          "appId": "cli_a913a13426789bd3",
          "appSecret": "bUabjhPq3kuwwUYpYS8qKeZNKHVO8iNg",
          "encryptKey": "cJHQOYtBjrapJdBlJVL4Aew3cNcF1eDw",
          "verificationToken": "szOt1ifBJVxw2aXSoHpaqfuccoXnPZ40"
        }
      },
      "groups": {
        "ops-group": "oc_YOUR_GROUP_ID_HERE"
      }
    }
  }
}
```

替换 `oc_YOUR_GROUP_ID_HERE` 为实际的群 ID。

保存文件。

✅ **检查点**: 配置文件已更新

---

### 步骤 3.4: 重启 OpenClaw（如需要）

如果 OpenClaw 正在运行，重启以加载新配置:

```bash
# 停止（根据您的启动方式）
# Ctrl+C 或 kill 进程

# 重新启动
openclaw start
```

✅ **检查点**: OpenClaw 成功启动

---

### 步骤 3.5: 测试消息发送

**方法 1: 在 OpenClaw 对话中测试**

对 Agent 说:
```
发送一条测试消息到飞书 ops-group: "K8s 运维 Agent 已上线！"
```

**方法 2: 使用飞书 skill（如果可用）**

如果您已经加载了飞书 skill:
```
/feishu send ops-group "测试消息"
```

**期望结果**:
- 在飞书 "K8s 运维群" 收到消息
- 消息来自机器人

✅ **检查点**: 成功收到测试消息

---

### 步骤 3.6: 配置 Cron 告警

验证 Cron 任务已配置发送到飞书:

```bash
cat ~/.openclaw/cron/jobs.json
```

确认 `k8s-morning-check` 任务有:
```json
{
  "id": "k8s-morning-check",
  "deliveryQueue": ["feishu:ops-group"]
}
```

✅ **检查点**: Cron 配置正确

---

### 步骤 3.7: 手动触发一次晨检（测试）

**对 Agent 说**:
```
执行 K8s 集群健康晨检，包括：
1. 检查所有节点状态
2. 检查 kube-system 命名空间的 Pod 状态
3. 检查是否有异常 Pod
4. 生成报告并发送到飞书 ops-group
```

**期望结果**:
- Agent 执行检查
- 在飞书群收到健康报告

报告格式类似:
```
【K8s 集群晨检报告】
时间: 2026-02-21 XX:XX

✅ 节点状态:
  - Master: 3/3 Ready
  - Worker: 3/3 Ready

✅ 系统 Pod: XX/XX Running

✅ development 命名空间:
  - nginx-test: 3/3 Ready

📊 总体状态: 健康
```

✅ **检查点**: 收到完整的晨检报告

---

### 步骤 3.8: 测试告警触发（可选）

**模拟异常场景**: 部署一个会失败的 Pod

```bash
# 在部署节点执行
cat > ~/k8s-test/bad-pod.yaml << 'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: bad-pod
  namespace: development
spec:
  containers:
  - name: nginx
    image: nginx:nonexistent-version
EOF

kubectl apply -f ~/k8s-test/bad-pod.yaml
```

等待几秒后，**对 Agent 说**:
```
检查 development 命名空间是否有异常 Pod，如果有，发送告警到飞书 ops-group
```

**期望结果**:
- Agent 发现 bad-pod 处于 ImagePullBackOff
- 发送告警到飞书群

告警格式:
```
⚠️【异常 Pod 告警】

命名空间: development
Pod: bad-pod
状态: ImagePullBackOff
原因: 镜像拉取失败

建议: 检查镜像名称是否正确
```

**清理**:
```bash
kubectl delete pod bad-pod -n development
```

✅ **检查点**: 收到异常告警

---

### 步骤 3.9: 在飞书群内交互（可选）

在飞书群内 @机器人 测试:

```
@机器人 列出所有节点
```

**期望**: 机器人在群内回复节点列表

```
@机器人 检查 development 的 Pod
```

**期望**: 机器人回复 Pod 状态

✅ **检查点**: 可以在飞书群内直接与 Agent 对话

---

### 🎉 任务 3 完成标志

- [x] 创建了飞书运维群
- [x] 获取了群组 ID
- [x] 配置文件已更新
- [x] 测试消息发送成功
- [x] 收到了晨检报告
- [x] 收到了异常告警（可选）
- [x] 可以在群内与 Agent 交互（可选）

---

## 📊 本周完成总结

### 完成情况

| 任务                | 状态    | 耗时         |
| ----------------- | ----- | ---------- |
| 任务 1: 部署测试应用      | ✅     | ~30 分钟     |
| 任务 2: 测试所有 Skills | ✅     | ~40 分钟     |
| 任务 3: 配置飞书告警      | ✅     | ~20 分钟     |
| **总计**            | **✅** | **~90 分钟** |

### 验证成果

- [x] 测试应用运行在 3 个副本
- [x] 可通过 NodePort 访问应用
- [x] 19 个 Skill 测试全部通过
- [x] 飞书告警配置成功
- [x] 收到了第一份晨检报告

---

## 🐛 故障排查

### 故障排查: 任务 1

#### 问题 1: Pod 一直 Pending

**症状**: Pod 状态停留在 Pending

**排查**:
```bash
kubectl describe pod <pod-name> -n development
```

查看 Events 部分，可能原因：
- 节点资源不足
- 镜像拉取中
- 存储卷问题

**解决**:
```bash
# 检查节点资源
kubectl top nodes

# 检查 Pod 事件
kubectl get events -n development
```

---

#### 问题 2: ImagePullBackOff

**症状**: Pod 状态显示 ImagePullBackOff

**原因**: 无法拉取 nginx:1.21 镜像

**解决方案 A**: 使用 Harbor 私有镜像

```bash
# 在部署节点拉取并推送到 Harbor
docker pull nginx:1.21
docker tag nginx:1.21 harbor.myarchitect.online/apps/nginx:1.21
docker push harbor.myarchitect.online/apps/nginx:1.21

# 修改 Deployment
kubectl set image deployment/nginx-test nginx=harbor.myarchitect.online/apps/nginx:1.21 -n development
```

**解决方案 B**: 配置节点的镜像拉取

确保节点可以访问 Docker Hub 或配置镜像加速器。

---

#### 问题 3: NodePort 无法访问

**症状**: 浏览器无法打开 http://172.16.190.111:30080

**排查**:
```bash
# 检查 Service
kubectl get svc nginx-test-nodeport -n development

# 检查 Pod 是否 Ready
kubectl get pods -n development

# 测试从集群内访问
kubectl run test --rm -it --image=busybox -- wget -O- nginx-test.development.svc.cluster.local
```

**可能原因**:
- 防火墙阻止 30080 端口
- Service selector 不匹配
- Pod 未 Ready

**解决**:
```bash
# 检查防火墙（在节点上）
iptables -L -n | grep 30080

# 或者使用端口转发代替 NodePort
kubectl port-forward -n development svc/nginx-test 8080:80
# 然后访问 http://localhost:8080
```

---

### 故障排查: 任务 2

#### 问题 4: Agent 无法连接 K8s 集群

**症状**: Agent 返回错误 "Unable to connect to cluster"

**排查**:
```bash
# 检查 kubeconfig
kubectl config view

# 测试连接
kubectl get nodes
```

**解决**:

确保 OpenClaw 可以访问 kubeconfig:

```json
// ~/.openclaw/openclaw.json
{
  "plugins": {
    "entries": {
      "k8s": {
        "enabled": true,
        "kubeconfigPath": "/root/.kube/config",
        "defaultContext": "kubernetes-admin@k8s-cluster1"
      }
    }
  }
}
```

重启 OpenClaw。

---

#### 问题 5: Agent 返回 "Forbidden"

**症状**: Agent 提示 RBAC 权限不足

**原因**: kubeconfig 的用户权限不足

**解决**:

使用 cluster-admin 角色的 kubeconfig，或确保用户有足够权限:

```bash
# 查看当前用户
kubectl config view --minify

# 检查权限
kubectl auth can-i get pods --all-namespaces
kubectl auth can-i delete pods --all-namespaces
```

---

### 故障排查: 任务 3

#### 问题 6: 飞书消息发送失败

**症状**: Agent 报告发送失败

**排查**:
```bash
# 检查 OpenClaw 日志
tail -f ~/.openclaw/logs/*.log | grep feishu
```

**可能原因**:
- 群组 ID 错误
- 机器人未在群内
- App 凭证过期

**解决**:

1. 确认机器人已添加到群
2. 重新获取群组 ID
3. 检查 appId 和 appSecret 是否正确

---

#### 问题 7: Agent 在飞书群内不响应

**症状**: @机器人 后无反应

**排查**:
1. 检查 OpenClaw 是否在运行
2. 检查日志是否有错误
3. 确认机器人有接收消息权限

**解决**:

在飞书开放平台检查:
- 权限配置 → 确保开启了"接收消息"权限
- 事件订阅 → 确保订阅了 im.message.receive_v1

---

## 📝 记录您的实践

建议在完成后记录到 memory:

```bash
cat > ~/.openclaw/memory/2026-02-21-week1-practice.md << 'EOF'
# 第一周实践记录

## 完成时间
2026-02-21

## 完成任务
- [x] 部署 nginx 测试应用
- [x] 测试 4 个 Skills (19 个测试)
- [x] 配置飞书告警

## 遇到的问题
1. 问题描述
   - 解决方案

## 学到的经验
1. 经验1
2. 经验2

## 下一步计划
- 下周任务...
EOF
```

---

## 🎯 下周预告

完成本周任务后，下周可以：

1. **模拟故障场景**
   - CrashLoopBackOff
   - OOMKilled
   - 节点故障

2. **编写运维 Runbook**
   - 常见问题处理流程
   - 记录到 MEMORY.md

3. **部署有状态应用**
   - MySQL
   - Redis
   - PV/PVC 使用

---

## 🎉 恭喜完成！

您已经完成了第一周的所有实践任务，现在您可以：

- ✅ 熟练使用 4 个 K8s Skills
- ✅ 通过 Agent 管理 K8s 集群
- ✅ 接收飞书实时告警
- ✅ 在飞书群内与 Agent 交互

**继续加油！** 🚀
