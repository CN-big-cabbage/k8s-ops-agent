# K8s Ops Agent

[English](README.md) | 简体中文

平台无关的 Kubernetes 运维 SDK，提供 32 个技能，覆盖资源管理、故障排查、安全审计和主机巡检。支持 MCP Server、CLI 和 OpenClaw 插件三种使用方式。

## 包列表

| 包名 | 描述 | 路径 |
|------|------|------|
| `@k8s-ops/core` | 平台无关的 K8s 运维 SDK | [packages/core](packages/core) |
| `@k8s-ops/mcp` | 面向 Claude、Cursor 等 AI 工具的 MCP Server | [packages/mcp-server](packages/mcp-server) |
| `@k8s-ops/cli` | 32 条命令的 CLI 工具 | [packages/cli](packages/cli) |
| `@k8s-ops/openclaw` | OpenClaw 插件适配器 | [packages/openclaw-plugin](packages/openclaw-plugin) |

## 技能列表

- 核心资源：Pod、Deployment、Service、Node、Namespace、Config、Ingress、Storage
- 运维操作：Exec、Port Forward、Logs、Metrics、Events、Event Analysis
- 高级能力：HPA、StatefulSet、DaemonSet、Job、CronJob、PDB、CRD、Gateway、Helm、YAML、Troubleshooting
- 安全与分析：RBAC、NetworkPolicy、Security Audit、Health、Topology、Cost
- 主机监控：`sys-monitor`

## 快速开始

### 作为 MCP Server（Claude Code、Cursor、VS Code）

将以下配置添加到 MCP 配置文件（`claude_desktop_config.json` 或 `.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "k8s-ops": {
      "command": "node",
      "args": ["packages/mcp-server/dist/index.js"],
      "env": {
        "KUBECONFIG": "~/.kube/config"
      }
    }
  }
}
```

### 作为 CLI 工具

```bash
# 克隆并构建
git clone git@github.com:CN-big-cabbage/k8s-ops-agent.git
cd k8s-ops-agent && pnpm install && pnpm build

# 运行命令
node packages/cli/dist/bin/k8s-ops.js pod list
node packages/cli/dist/bin/k8s-ops.js health cluster
node packages/cli/dist/bin/k8s-ops.js deploy list -n kube-system
```

### 作为 OpenClaw 插件

```bash
git clone git@github.com:CN-big-cabbage/k8s-ops-agent.git
cd k8s-ops-agent && pnpm install && pnpm build
openclaw plugins install --link /path/to/k8s-ops-agent/packages/openclaw-plugin
openclaw gateway restart
```

### 前置条件

确认 `kubectl` 已能访问目标集群：

```bash
kubectl get nodes
```

## 文档导航

- 总导航：[DOCS.md](DOCS.md)
- 安装与首跑：[docs/guides/getting-started.md](docs/guides/getting-started.md)
- 运维手册：[docs/guides/operations.md](docs/guides/operations.md)
- 集成手册：[docs/guides/integrations.md](docs/guides/integrations.md)
- 示例与测试：[examples/TEST-GUIDE.md](examples/TEST-GUIDE.md)

## 开发

```bash
pnpm install        # 安装依赖
pnpm build          # 构建所有包
pnpm test           # 运行所有测试
```

项目使用 pnpm workspaces + Turborepo。核心 SDK 在 [packages/core](packages/core)，各适配器通过 `@k8s-ops/core` 引用。
