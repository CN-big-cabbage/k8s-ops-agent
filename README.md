# OpenClaw Kubernetes Plugin

English | [简体中文](README_CN.md)

Kubernetes operations plugin for OpenClaw. The repository provides 30+ K8s-focused skills for resource management, troubleshooting, security checks, and basic host monitoring.

## Repository Contents

- Core resources: Pod, Deployment, Service, Node, Namespace, Config, Ingress, Storage
- Operations: Exec, Port Forward, Logs, Metrics, Events, Event Analysis
- Advanced: HPA, StatefulSet, DaemonSet, Job, CronJob, PDB, CRD, Gateway, Helm, YAML, Troubleshooting
- Security and analysis: RBAC, NetworkPolicy, Security Audit, Health, Topology, Cost
- Host monitoring: `sys-monitor`

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Install the plugin into OpenClaw:

```bash
openclaw plugins install --link /path/to/k8s-ops-agent
```

3. Ensure `kubectl` works with your target cluster:

```bash
kubectl get nodes
```

4. Restart OpenClaw if needed:

```bash
openclaw gateway restart
```

For detailed setup steps, configuration, and verification, see [docs/guides/getting-started.md](docs/guides/getting-started.md).

## Documentation

- Full docs index: [DOCS.md](DOCS.md)
- Setup and first run: [docs/guides/getting-started.md](docs/guides/getting-started.md)
- Operations handbook: [docs/guides/operations.md](docs/guides/operations.md)
- Integrations handbook: [docs/guides/integrations.md](docs/guides/integrations.md)
- Example manifests and test guide: [examples/TEST-GUIDE.md](examples/TEST-GUIDE.md)
- Archived practice notes: [docs/archive](docs/archive)

## Development

Run tests:

```bash
npm test
```

The plugin entry point is [index.ts](index.ts); skill modules live under [skills](skills).
