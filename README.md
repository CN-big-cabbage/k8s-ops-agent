# K8s Ops Agent

English | [简体中文](README_CN.md)

Platform-agnostic Kubernetes operations SDK with 32 skills for resource management, troubleshooting, security auditing, and host monitoring. Ships as a core library, MCP Server, CLI, and OpenClaw plugin.

## Packages

| Package | Description | Path |
|---------|-------------|------|
| `@k8s-ops/core` | Platform-agnostic K8s operations SDK | [packages/core](packages/core) |
| `@k8s-ops/mcp` | MCP Server for Claude, Cursor, and other AI tools | [packages/mcp-server](packages/mcp-server) |
| `@k8s-ops/cli` | CLI toolkit with 32 commands | [packages/cli](packages/cli) |
| `@k8s-ops/openclaw` | OpenClaw plugin adapter | [packages/openclaw-plugin](packages/openclaw-plugin) |

## Skills

- Core resources: Pod, Deployment, Service, Node, Namespace, Config, Ingress, Storage
- Operations: Exec, Port Forward, Logs, Metrics, Events, Event Analysis
- Advanced: HPA, StatefulSet, DaemonSet, Job, CronJob, PDB, CRD, Gateway, Helm, YAML, Troubleshooting
- Security and analysis: RBAC, NetworkPolicy, Security Audit, Health, Topology, Cost
- Host monitoring: `sys-monitor`

## Quick Start

### As MCP Server (Claude Code, Cursor, VS Code)

Add to your MCP config (`claude_desktop_config.json` or `.cursor/mcp.json`):

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

### As CLI Tool

```bash
# Clone and build
git clone git@github.com:CN-big-cabbage/k8s-ops-agent.git
cd k8s-ops-agent && pnpm install && pnpm build

# Run commands
node packages/cli/dist/bin/k8s-ops.js pod list
node packages/cli/dist/bin/k8s-ops.js health cluster
node packages/cli/dist/bin/k8s-ops.js deploy list -n kube-system
```

### As OpenClaw Plugin

```bash
git clone git@github.com:CN-big-cabbage/k8s-ops-agent.git
cd k8s-ops-agent && pnpm install && pnpm build
openclaw plugins install --link /path/to/k8s-ops-agent/packages/openclaw-plugin
openclaw gateway restart
```

### Prerequisites

Ensure `kubectl` works with your target cluster:

```bash
kubectl get nodes
```

## Documentation

- Full docs index: [DOCS.md](DOCS.md)
- Setup and first run: [docs/guides/getting-started.md](docs/guides/getting-started.md)
- Operations handbook: [docs/guides/operations.md](docs/guides/operations.md)
- Integrations handbook: [docs/guides/integrations.md](docs/guides/integrations.md)
- Example manifests and test guide: [examples/TEST-GUIDE.md](examples/TEST-GUIDE.md)

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Build all packages
pnpm test           # Run all tests
```

Project uses pnpm workspaces with Turborepo. The core SDK is in [packages/core](packages/core); adapters consume it via `@k8s-ops/core`.
