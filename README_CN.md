# OpenClaw Kubernetes 插件

[English](README.md) | 简体中文

这是一个面向 OpenClaw 的 Kubernetes 运维插件仓库，提供 30+ 个围绕 K8s 资源管理、故障排查、安全检查和主机巡检的运维技能。

## 仓库内容

- 核心资源：Pod、Deployment、Service、Node、Namespace、Config、Ingress、Storage
- 运维操作：Exec、Port Forward、Logs、Metrics、Events、Event Analysis
- 高级能力：HPA、StatefulSet、DaemonSet、Job、CronJob、PDB、CRD、Gateway、Helm、YAML、Troubleshooting
- 安全与分析：RBAC、NetworkPolicy、Security Audit、Health、Topology、Cost
- 主机监控：`sys-monitor`

## 快速开始

1. 安装依赖：

```bash
npm install
```

2. 将插件安装到 OpenClaw：

```bash
openclaw plugins install --link /path/to/k8s-ops-agent
```

3. 确认当前 `kubectl` 已能访问目标集群：

```bash
kubectl get nodes
```

4. 必要时重启 OpenClaw：

```bash
openclaw gateway restart
```

更完整的安装步骤、配置说明和验证方法请查看 [docs/guides/getting-started.md](docs/guides/getting-started.md)。

## 文档导航

- 总导航： [DOCS.md](DOCS.md)
- 安装与首跑： [docs/guides/getting-started.md](docs/guides/getting-started.md)
- 运维手册： [docs/guides/operations.md](docs/guides/operations.md)
- 集成手册： [docs/guides/integrations.md](docs/guides/integrations.md)
- 示例与测试： [examples/TEST-GUIDE.md](examples/TEST-GUIDE.md)
- 历史实践归档： [docs/archive](docs/archive)

## 开发

运行测试：

```bash
npm test
```

插件入口文件为 [index.ts](index.ts)，各个技能模块位于 [skills](skills)。
