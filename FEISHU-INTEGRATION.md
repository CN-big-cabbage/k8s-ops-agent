# 飞书告警集成指南

将 K8s 集群告警自动发送到飞书群，实现实时运维通知。

---

## 🎯 目标

1. **自动巡检**: 每日定时检查集群健康，发送报告到飞书
2. **异常告警**: 发现问题立即通知到飞书群
3. **交互操作**: 在飞书群内直接与 Agent 对话进行运维操作

---

## 📋 前置条件

### 1. 飞书机器人已配置

您的 openclaw 已配置飞书渠道:
- App ID: `cli_a913a13426789bd3`
- 配置文件: `~/.openclaw/config.yaml`

### 2. 创建运维群组

在飞书创建一个运维群，添加机器人：

1. 创建群聊："K8s 运维群"
2. 添加机器人到群
3. 记录群 ID（从飞书后台获取）

---

## 🔧 配置步骤

### Step 1: 配置飞书群组 ID

编辑 `~/.openclaw/openclaw.json`，添加群组配置：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "groups": {
        "ops-group": "oc_xxxxxxxxxxxxxx",        // K8s 运维群 ID
        "management": "oc_yyyyyyyyyyyyyy"        // 管理层周报群 ID
      }
    }
  }
}
```

**获取群 ID**:
1. 登录飞书开放平台: https://open.feishu.cn/
2. 进入应用详情 → 群组管理
3. 查找群聊，复制群 ID

### Step 2: 测试飞书连接

在 OpenClaw 对话中测试：

```
"发送一条测试消息到飞书 ops-group"
```

或使用飞书 skill（如果已加载）。

### Step 3: 配置 Cron 任务发送到飞书

Cron 任务已配置（在 `~/.openclaw/cron/jobs.json`）:

```json
{
  "k8s-morning-check": {
    "schedule": "0 9 * * *",
    "deliveryQueue": ["feishu:ops-group"]  // ← 发送到飞书群
  }
}
```

`deliveryQueue` 参数说明：
- `["feishu:ops-group"]`: 发送到 ops-group 群
- `[]`: 不发送，仅记录到 memory
- `["feishu:ops-group", "feishu:management"]`: 发送到多个群

---

## 📊 告警场景配置

### 场景 1: 每日晨检报告

**触发时间**: 每天 9:00

**内容**:
```
【K8s 集群晨检报告】
时间: 2026-02-21 09:00

✅ 节点状态:
  - Master: 3/3 Ready
  - Node: 3/3 Ready

✅ Etcd 集群: 3/3 Healthy

✅ 系统 Pod: 45/45 Running

⚠️ 异常 Pod:
  - development/nginx-test-abc (CrashLoopBackOff)

建议: 检查 nginx-test 部署配置
```

**配置**:
```json
{
  "k8s-morning-check": {
    "schedule": "0 9 * * *",
    "prompt": "执行 K8s 集群健康晨检...",
    "deliveryQueue": ["feishu:ops-group"]
  }
}
```

### 场景 2: Etcd 紧急告警

**触发条件**: Etcd 节点 unhealthy

**内容**:
```
🚨【紧急】Etcd 集群异常

节点: k8s-etcd2 (172.16.190.107)
状态: Unhealthy
时间: 2026-02-21 14:35

影响: 可能导致集群不稳定

建议:
1. 立即检查 etcd2 节点
2. 查看 etcd 日志
3. 必要时重启 etcd 服务
```

**配置**:
```json
{
  "k8s-etcd-health-check": {
    "schedule": "0 */6 * * *",
    "prompt": "检查 Etcd 集群健康状态。如果发现 unhealthy，立即发送紧急告警",
    "deliveryQueue": []  // 动态判断：正常不发送，异常才发送
  }
}
```

### 场景 3: 证书过期预警

**触发时间**: 每月 1 号 10:00

**内容**:
```
⚠️【预警】K8s 证书即将过期

证书路径: /etc/kubernetes/ssl/apiserver.pem
过期时间: 2026-03-15
剩余天数: 22 天

建议: 提前续期证书，避免服务中断

续期命令:
cd /etc/kubeasz
./ezctl renew-cert k8s-cluster1
```

**配置**:
```json
{
  "k8s-cert-expiry-check": {
    "schedule": "0 10 1 * *",
    "deliveryQueue": ["feishu:ops-group"]
  }
}
```

### 场景 4: Pod 重启异常报告

**触发时间**: 每天 18:00

**内容**:
```
📊【每日报告】Pod 重启统计

过去 24 小时内重启 > 5 次的 Pod:

1. production/payment-service-abc
   重启次数: 12
   原因: OOMKilled
   建议: 增加 Memory Limit

2. staging/api-gateway-xyz
   重启次数: 7
   原因: CrashLoopBackOff
   建议: 检查应用日志

详细报告: memory/pod-restart-2026-02-21.md
```

**配置**:
```json
{
  "k8s-pod-restart-report": {
    "schedule": "0 18 * * *",
    "deliveryQueue": []  // 只记录，不发送（可改为发送）
  }
}
```

### 场景 5: 运维周报

**触发时间**: 每周一 10:00

**内容**:
```
📋【K8s 运维周报】2026-W08

本周概览:
- Deployment 变更: 15 次
- Pod 重启事件: 23 次
- 节点维护: 1 次（k8s-node2）

重要事件:
1. 2026-02-18: production 扩容 frontend 到 10 副本
2. 2026-02-20: 紧急回滚 payment-service v2.3.0

系统健康:
- 节点: 6/6 Ready
- Etcd: 持续稳定
- 异常 Pod: 平均 < 2 个/天

下周计划:
- 升级 K8s 到 1.34.2
- 添加 Prometheus 监控
```

**配置**:
```json
{
  "k8s-weekly-report": {
    "schedule": "0 10 * * 1",
    "deliveryQueue": ["feishu:management"]
  }
}
```

---

## 🎨 消息格式优化

### 使用飞书卡片消息

对于重要告警，可以使用飞书卡片格式（需飞书 skill 支持）:

```json
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {
        "tag": "plain_text",
        "content": "🚨 K8s 集群异常告警"
      },
      "template": "red"
    },
    "elements": [
      {
        "tag": "div",
        "text": {
          "tag": "lark_md",
          "content": "**节点**: k8s-node2\n**状态**: NotReady\n**时间**: 2026-02-21 14:35"
        }
      },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "button",
            "text": {
              "tag": "plain_text",
              "content": "查看详情"
            },
            "type": "primary"
          },
          {
            "tag": "button",
            "text": {
              "tag": "plain_text",
              "content": "确认已处理"
            }
          }
        ]
      }
    ]
  }
}
```

### 消息优先级

- 🚨 **Critical**: 红色，@所有人
  - Etcd 故障、Master 节点宕机、集群不可用

- ⚠️ **Warning**: 黄色
  - 节点 NotReady、证书即将过期、资源不足

- ℹ️ **Info**: 蓝色
  - 日常巡检报告、周报

---

## 🔄 交互式运维

### 在飞书群内直接操作

在 K8s 运维群内 @机器人：

```
@机器人 列出所有节点
@机器人 检查 production 命名空间的 Pod
@机器人 nginx-test 部署有问题，帮我看看
@机器人 扩容 frontend 到 10 个副本
```

### 告警响应流程

1. **收到告警** → 飞书卡片通知
2. **点击按钮** → 触发 Agent 操作
3. **Agent 排查** → 自动诊断问题
4. **返回结果** → 发送到群内
5. **人工确认** → 点击"已处理"

---

## 📝 配置检查清单

- [ ] 飞书机器人已添加到运维群
- [ ] 群组 ID 已配置到 `openclaw.json`
- [ ] Cron 任务 `deliveryQueue` 已设置
- [ ] 测试消息发送成功
- [ ] Agent 能在群内响应命令

---

## 🐛 故障排查

### 问题 1: 消息发送失败

**排查**:
```bash
# 查看 OpenClaw 日志
tail -f ~/.openclaw/logs/*.log | grep feishu
```

**可能原因**:
- 群组 ID 错误
- 机器人未添加到群
- 飞书 App 凭证过期

### 问题 2: Agent 不响应群消息

**排查**:
1. 检查机器人是否在线
2. 确认是否 @机器人
3. 查看 OpenClaw 运行状态

### 问题 3: Cron 任务未发送消息

**排查**:
```bash
# 检查 Cron 任务配置
cat ~/.openclaw/cron/jobs.json

# 查看 Cron 执行日志
tail -f ~/.openclaw/logs/cron.log
```

---

## 💡 最佳实践

### 1. 告警分级

- **Critical** → 立即处理 → 发送到运维群 + 电话
- **Warning** → 工作时间处理 → 发送到运维群
- **Info** → 记录即可 → 仅记录到 memory

### 2. 避免告警疲劳

- 不要过于频繁发送告警
- 相同问题在短时间内只告警一次
- 使用 `deliveryQueue: []` 仅记录不发送

### 3. 告警上下文

每条告警包含：
- 问题描述
- 影响范围
- 建议操作
- 相关日志/链接

### 4. 人机协作

- Agent 自动诊断 → 人工确认
- 常规操作 Agent 执行 → 关键操作人工审批
- 记录所有操作到 memory

---

## 📖 相关文档

- 飞书机器人配置: https://open.feishu.cn/document/home/
- OpenClaw 飞书集成: `~/.openclaw/extensions/feishu/`
- Cron 任务配置: `~/.openclaw/cron/jobs.json`

---

**配置完成后，您将拥有一个全自动的 K8s 运维助手！** 🚀
