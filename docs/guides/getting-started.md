# Getting Started

## 1. Prerequisites

- OpenClaw installed and running
- Node.js 18 or newer
- `kubectl` installed
- A valid kubeconfig, usually at `~/.kube/config`

## 2. Install Dependencies

```bash
npm install
```

## 3. Install the Plugin into OpenClaw

```bash
openclaw plugins install --link /path/to/k8s-ops-agent
```

If your environment still relies on globally installed OpenClaw packages, create the required symlinks first:

```bash
ln -s /usr/local/lib/node_modules/openclaw node_modules/openclaw
mkdir -p node_modules/@sinclair
ln -s /usr/local/lib/node_modules/openclaw/node_modules/@sinclair/typebox node_modules/@sinclair/typebox
```

## 4. Enable and Configure the Plugin

Add an entry to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "k8s": {
        "enabled": true,
        "config": {
          "kubeconfigPath": "/custom/path/to/kubeconfig",
          "defaultContext": "prod-cluster"
        }
      }
    }
  }
}
```

If you only need the default kubeconfig path, `enabled: true` is enough.

## 5. Verify Cluster Access

```bash
kubectl config current-context
kubectl get nodes
kubectl get pods --all-namespaces
```

For local testing, you can use `kind` or `minikube`.

## 6. Restart and Smoke Test

Restart OpenClaw:

```bash
openclaw gateway restart
```

Then try a few prompts:

```text
List all pods in the default namespace
Describe the nginx pod
Show me recent warning events in production
```

## 7. Example Workload

Use the example manifest and guide if you want a safe practice target:

- [../../examples/01-nginx-test.yaml](../../examples/01-nginx-test.yaml)
- [../../examples/TEST-GUIDE.md](../../examples/TEST-GUIDE.md)

## 8. Next Reading

- [operations.md](operations.md)
- [integrations.md](integrations.md)
- [../../examples/TEST-GUIDE.md](../../examples/TEST-GUIDE.md)
