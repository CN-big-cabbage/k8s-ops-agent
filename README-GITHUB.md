# OpenClaw K8s 运维 Agent

基于 OpenClaw 框架的 Kubernetes 运维自动化系统。

> 个人学习项目 - K8s 1.34.1 二进制部署环境

---

## 🎯 项目简介

这是一个完整的 K8s 运维 Agent 系统，通过 AI 对话实现：
- Pod、Deployment、Node、Service 管理
- 自动化巡检和告警
- 飞书集成实时通知
- 故障诊断和处置建议

### 技术栈

- **Framework**: OpenClaw
- **Language**: TypeScript
- **K8s Client**: @kubernetes/client-node
- **Platform**: Kubernetes 1.34.1
- **Deployment**: kubeasz 二进制部署

---

## 📂 项目结构

```
.
├── README.md                    # 本文件
├── SUMMARY.md                   # 快速启用指南
├── QUICKSTART.md                # 快速上手
├── WEEK1-PRACTICE.md            # 第一周实践指南 ⭐
│
├── 📚 完整文档
│   ├── SCENARIOS.md             # 8 个实战场景
│   ├── REAL-WORLD-OPS.md        # 真实环境运维指南
│   ├── FEISHU-INTEGRATION.md    # 飞书告警集成
│   └── NEXT-STEPS-COMPLETED.md  # 完成总结
│
├── 🧪 测试应用
│   └── examples/
│       ├── 01-nginx-test.yaml   # Nginx 测试应用
│       └── TEST-GUIDE.md        # 测试指南
│
├── 🛠️ Skills (4 个)
│   ├── k8s-pod/                 # Pod 管理 (5 操作)
│   ├── k8s-deploy/              # Deployment 管理 (8 操作)
│   ├── k8s-node/                # 节点管理 (10 操作)
│   └── k8s-svc/                 # Service 管理 (4 操作)
│
└── 🔧 配置
    ├── package.json             # 依赖
    ├── tsconfig.json            # TS 配置
    └── openclaw.plugin.json     # 插件声明
```

---

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启用插件

编辑 `~/.openclaw/openclaw.json`:

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

### 3. 部署测试应用

```bash
kubectl apply -f examples/01-nginx-test.yaml
```

### 4. 测试功能

对 Agent 说：
```
"列出所有节点"
"查看 development 命名空间的 Pod"
```

详细步骤见：[WEEK1-PRACTICE.md](./WEEK1-PRACTICE.md)

---

## 🎓 学习路线

### 第一周 ✅
- [x] 部署测试应用
- [x] 测试 4 个 Skills (19 个测试)
- [x] 配置飞书告警

### 第二周
- [ ] 模拟故障场景（CrashLoopBackOff、OOMKilled）
- [ ] 编写运维 Runbook
- [ ] 部署有状态应用（MySQL）

### 第三周
- [ ] 集成 Prometheus 监控
- [ ] 配置自动化巡检
- [ ] 告警自动处置

---

## 📊 功能清单

### 已实现 (4 个 Skills, 27 个操作)

| Skill | 功能 | 操作 |
|-------|------|------|
| **k8s-pod** | Pod 管理 | list, describe, logs, status, restart |
| **k8s-deploy** | Deployment 管理 | list, describe, scale, rollout (status/history/restart/undo), update-image |
| **k8s-node** | 节点管理 | list, describe, status, cordon, uncordon, drain, taints, labels |
| **k8s-svc** | Service 管理 | list, describe, endpoints, status |

### 自动化功能

- ✅ Cron 定时巡检（6 个任务）
- ✅ Heartbeat 实时监控
- ✅ 飞书告警集成
- ✅ 故障诊断建议

---

## 💬 使用示例

### 日常运维
```
"列出所有节点状态"
"检查 production 命名空间的 Pod"
"nginx-test 部署有问题，帮我看看"
```

### 应用管理
```
"把 frontend 扩容到 10 个副本"
"更新 api-server 的镜像到 v2.0"
"回滚 payment-service 到上个版本"
```

### 节点维护
```
"我要维护 k8s-node2，帮我准备"
→ Agent 自动 cordon + drain

"k8s-node2 维护完成，恢复它"
→ Agent 自动 uncordon
```

### 故障排查
```
"为什么 order-service 连接不上？"
→ Agent 检查 Service、Endpoints、Pod 状态

"payment-pod 一直重启，什么原因？"
→ Agent 查看日志、Events，诊断问题
```

---

## 🏗️ 集群环境

### 架构

```
VIP (Keepalived): 172.16.190.100
    ↓
HAProxy (2 台)
    ↓
K8s Masters (3 台)
    ↓
Etcd Cluster (3 台独立部署)
    ↓
Worker Nodes (3 台)
    ↓
Harbor Registry (2 台)
```

### 节点清单

- **Masters**: 172.16.190.101-103
- **Workers**: 172.16.190.111-113
- **Etcd**: 172.16.190.106-108
- **HAProxy**: 172.16.190.109-110
- **Harbor**: 172.16.190.104-105

详细配置见：[REAL-WORLD-OPS.md](./REAL-WORLD-OPS.md)

---

## 📖 文档导航

### 新手入门
1. [SUMMARY.md](./SUMMARY.md) - 启用插件
2. [WEEK1-PRACTICE.md](./WEEK1-PRACTICE.md) - 第一周实践 ⭐
3. [TEST-GUIDE.md](./examples/TEST-GUIDE.md) - 测试指南

### 进阶使用
1. [SCENARIOS.md](./SCENARIOS.md) - 8 个实战场景
2. [REAL-WORLD-OPS.md](./REAL-WORLD-OPS.md) - 真实环境运维
3. [FEISHU-INTEGRATION.md](./FEISHU-INTEGRATION.md) - 飞书集成

### Skills 文档
- [k8s-pod/SKILL.md](./skills/k8s-pod/SKILL.md)
- [k8s-deploy/SKILL.md](./skills/k8s-deploy/SKILL.md)
- [k8s-node/SKILL.md](./skills/k8s-node/SKILL.md)
- [k8s-svc/SKILL.md](./skills/k8s-svc/SKILL.md)

---

## 🛠️ 开发

### 添加新 Skill

1. 创建 skill 目录：`skills/k8s-xxx/`
2. 编写 SKILL.md 文档
3. 实现 TypeScript handler
4. 在 index.ts 注册

### 编译

```bash
# TypeScript 编译（如需要）
npm run build
```

---

## 🤝 贡献

这是个人学习项目，欢迎交流：
- Issues: 报告问题或建议
- Discussions: 讨论 K8s 运维实践

---

## 📄 License

MIT License - 个人学习项目

---

## 🙏 致谢

- **OpenClaw** - AI Agent 框架
- **kubeasz** - K8s 部署工具
- **@kubernetes/client-node** - K8s 官方 JS 客户端
- **马哥教育** - 云原生课程

---

## 📝 学习记录

### 2026-02-21
- ✅ 完成 4 个 Skills 开发
- ✅ 配置自动化巡检
- ✅ 集成飞书告警
- ✅ 完成第一周实践

### 下一步
- [ ] 模拟故障场景
- [ ] 部署 Prometheus
- [ ] 编写更多 Runbook

---

**持续学习中...** 🚀
