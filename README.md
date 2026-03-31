# OpenClaw Kubernetes Plugin

English | [简体中文](README_CN.md)

Kubernetes operations plugin for OpenClaw, providing tools to manage K8s resources.

## Features

### Skills (32 tools)

#### Core Resources
- **k8s-pod**: Pod management (list, describe, logs, restart, status)
- **k8s-deploy**: Deployment management (list, describe, scale, rollout status/history/restart/undo, update-image)
- **k8s-node**: Node management (list, describe, status, cordon, uncordon, drain, taints, labels)
- **k8s-svc**: Service management (list, describe, endpoints, status)
- **k8s-config**: ConfigMap/Secret management (list, describe, get data, create, update, delete)
- **k8s-ingress**: Ingress management (list, describe, rules, TLS, annotations, update, delete)
- **k8s-storage**: PVC/PV/StorageClass management (list, describe, capacity, create, delete, resize)
- **k8s-namespace**: Namespace operations (list, describe, quota, limits, create, delete)

#### Operations
- **k8s-exec**: Container execution (exec, file_read, file_list, env, process_list, network_check)
- **k8s-portforward**: Port forwarding (create, list, close port forwards to pods/services)
- **k8s-logs**: Advanced log operations (search, multi_pod, since, compare, stats, export)
- **k8s-metrics**: Resource metrics and monitoring (pod_resources, node_resources, top_pods, top_nodes, namespace_usage, capacity_report)

#### Monitoring
- **k8s-events**: Event querying (list, filter, recent, export)
- **k8s-event-analysis**: Event analysis (timeline, anomaly, correlate, summary)

#### Workload Management
- **k8s-statefulset**: StatefulSet operations (list, describe, status, scale, rollout restart/undo, update-image)
- **k8s-daemonset**: DaemonSet operations (list, describe, status, rollout restart/undo, update-image)
- **k8s-job**: Job operations (list, describe, status, logs, create, delete)
- **k8s-cronjob**: CronJob operations (list, describe, status, suspend, resume, trigger, create, delete)
- **k8s-hpa**: HPA operations (list, describe, status, create, update, delete)

#### Security & RBAC
- **k8s-rbac**: RBAC operations (list/describe ServiceAccounts, Roles, ClusterRoles, Bindings, who_can check, audit)
- **k8s-netpol**: NetworkPolicy operations (list, describe, check pod policies, create, delete, audit)
- **k8s-security**: Security audit (scan images, check pod security, RBAC audit, secrets audit)

#### Advanced Ops
- **k8s-pdb**: PodDisruptionBudget operations (list, describe, status, create, delete, check protection)
- **k8s-crd**: CRD operations (list, describe, get/list custom resources)
- **k8s-health**: Cluster health check (components, nodes, pods, etcd, networking, overall)
- **k8s-topology**: Cluster topology (node distribution, pod placement, zone spread, affinity analysis)
- **k8s-cost**: Cost analysis (namespace cost, node cost, idle resources, optimization suggestions)

#### Ecosystem Integration
- **k8s-helm**: Helm operations (list releases, describe, history, values, rollback)
- **k8s-yaml**: YAML management (export, validate, diff, apply, template generation)
- **k8s-gateway**: Gateway API operations (list, describe, routes, status)
- **k8s-troubleshoot**: Troubleshooting (diagnose pods, services, nodes, networking, DNS)

#### System Monitoring
- **sys-monitor**: Host monitoring via SSH (CPU, memory, disk, network, processes, system info, overview)

## Installation

### Prerequisites

- [OpenClaw](https://docs.openclaw.ai/) installed and running
- Node.js >= 18
- `kubectl` installed and a valid kubeconfig at `~/.kube/config`

### Step 1: Clone the repository

```bash
git clone https://github.com/CN-big-cabbage/k8s-ops-agent.git
cd k8s-ops-agent
```

### Step 2: Install dependencies

```bash
npm install
```

### Step 3: Create required symlinks

The plugin depends on OpenClaw's SDK and TypeBox. Create symlinks to the global OpenClaw package:

```bash
ln -s /usr/local/lib/node_modules/openclaw node_modules/openclaw
mkdir -p node_modules/@sinclair
ln -s /usr/local/lib/node_modules/openclaw/node_modules/@sinclair/typebox node_modules/@sinclair/typebox
```

> **Note:** If the OpenClaw global path differs on your system, run `npm root -g` to find it and adjust the paths accordingly.

### Step 4: Install plugin into OpenClaw

```bash
openclaw plugins install --link /path/to/k8s-ops-agent
```

The `--link` flag creates a reference to your local directory so updates take effect immediately without reinstalling.

### Step 5: Verify plugin is loaded

```bash
openclaw plugins list | grep k8s
```

Expected output:
```
│ Kubernetes   │ k8s      │ openclaw │ loaded   │ ~/path/to/k8s-ops-agent/index.ts │ 1.8.0 │
```

### Step 6: Restart the gateway

```bash
openclaw gateway restart
```

### (Optional) Configure kubeconfig path

If your kubeconfig is not at the default `~/.kube/config`, edit `~/.openclaw/openclaw.json`:

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

### Troubleshooting Installation

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot find module 'openclaw/plugin-sdk'` | Missing openclaw symlink | Recreate symlink (Step 3) |
| `plugin not found: k8s` | Not installed via CLI | Run `openclaw plugins install --link` (Step 4) |
| `missing register/activate export` | Wrong plugin entry method | Ensure `index.ts` uses `register()` not `load()` |
| `kubectl not configured` | No kubeconfig | Copy kubeconfig to `~/.kube/config` |

## Usage

### List Pods

```
List all pods in the default namespace
```

Agent will use:
```json
{ "action": "list", "namespace": "default" }
```

### Get Pod Logs

```
Show me logs for nginx-deployment-abc123 in production namespace
```

Agent will use:
```json
{ "action": "logs", "namespace": "production", "pod_name": "nginx-deployment-abc123" }
```

### Troubleshoot Crashed Pod

```
The payment-service pod is crashing, help me debug it
```

Agent will:
1. Check pod status
2. Get previous logs (from crashed container)
3. Describe pod to see events

### Restart a Pod

```
Restart the frontend-app-xyz pod in staging
```

Agent will use:
```json
{ "action": "restart", "namespace": "staging", "pod_name": "frontend-app-xyz" }
```

### Execute Command in Container

```
Check what's in /etc/nginx on the nginx pod
```

Agent will use:
```json
{ "action": "exec", "namespace": "default", "pod_name": "nginx-abc123", "command": "ls -la /etc/nginx" }
```

### Search Logs

```
Search for errors in api-server logs
```

Agent will use:
```json
{ "action": "search", "namespace": "default", "pod_name": "api-server-xyz", "pattern": "ERROR|WARN", "tail_lines": 500 }
```

### Multi-Pod Log Aggregation

```
Show me logs from all api pods
```

Agent will use:
```json
{ "action": "multi_pod", "namespace": "production", "label_selector": "app=api-server", "tail_lines": 100 }
```

### Network Connectivity Check

```
Can the app pod reach redis?
```

Agent will use:
```json
{ "action": "network_check", "namespace": "default", "pod_name": "app-abc123", "target_host": "redis-service", "target_port": 6379 }
```

### Resource Metrics

```
Show me top pods by CPU usage in production
```

Agent will use:
```json
{ "action": "top_pods", "namespace": "production", "sort_by": "cpu", "top_n": 10 }
```

### Capacity Report

```
Give me a cluster capacity report
```

Agent will use:
```json
{ "action": "capacity_report" }
```

### ConfigMap/Secret Management

```
Show me the data in the app-config ConfigMap
```

Agent will use:
```json
{ "action": "get_cm_data", "namespace": "default", "configmap_name": "app-config" }
```

```
Get the database password from db-credentials secret
```

Agent will use:
```json
{ "action": "get_secret_data", "namespace": "production", "secret_name": "db-credentials", "key": "password" }
```

### Ingress Management

```
List all ingresses in production
```

Agent will use:
```json
{ "action": "list", "namespace": "production" }
```

```
Show routing rules for the api-ingress
```

Agent will use:
```json
{ "action": "rules", "namespace": "default", "ingress_name": "api-ingress" }
```

### Namespace Management

```
Show me a resource summary for the staging namespace
```

Agent will use:
```json
{ "action": "summary", "namespace": "staging" }
```

```
Check resource quota for production namespace
```

Agent will use:
```json
{ "action": "quota", "namespace": "production" }
```

### Port Forwarding

```
Forward local port 8080 to the postgres pod on port 5432
```

Agent will use:
```json
{ "action": "create", "namespace": "default", "pod_name": "postgres-abc123", "local_port": 8080, "pod_port": 5432 }
```

```
List all active port forwards
```

Agent will use:
```json
{ "action": "list" }
```

### Storage Management

```
List all PVCs in production
```

Agent will use:
```json
{ "action": "list_pvc", "namespace": "production" }
```

```
Find which pods are using the data-pvc volume
```

Agent will use:
```json
{ "action": "find_pods", "namespace": "default", "pvc_name": "data-pvc" }
```

```
Generate a storage usage report
```

Agent will use:
```json
{ "action": "usage_report" }
```

### Event Monitoring

```
Show me recent warning events in production
```

Agent will use:
```json
{ "action": "filter", "namespace": "production", "event_type": "Warning" }
```

### Anomaly Detection

```
Check for anomalies in the default namespace
```

Agent will use:
```json
{ "action": "anomaly", "namespace": "default", "warning_threshold": 5 }
```

### Event Correlation

```
Correlate events for the api-server pod
```

Agent will use:
```json
{ "action": "correlate", "namespace": "production", "resource_kind": "Pod", "resource_name": "api-server-abc123" }
```

## Configuration in TOOLS.md

Add cluster-specific notes to `~/.openclaw/workspace/TOOLS.md`:

```markdown
### Kubernetes Clusters

- **prod-k8s-01** (192.168.1.100)
  - Context: prod-cluster
  - Critical services: order-service, payment-gateway
  - SLA: 99.99%

- **staging-k8s-01** (192.168.1.101)
  - Context: staging-cluster
  - For testing before production deployment

### Common Operations

- Restart order-service: namespace=production, label=app=order-service
- Check payment gateway: namespace=production, pod prefix=payment-gateway-
```

## Kubeconfig Setup

The plugin uses `~/.kube/config` by default. Ensure it's configured:

```bash
kubectl config get-contexts
kubectl config use-context <your-context>
```

## RBAC Permissions

Ensure your kubeconfig has appropriate RBAC permissions:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: openclaw-ops
rules:
  # Pod operations (k8s-pod, k8s-exec, k8s-logs, k8s-portforward)
  - apiGroups: [""]
    resources: ["pods", "pods/log", "pods/exec"]
    verbs: ["get", "list", "watch", "create"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["delete"]  # For restart action
  - apiGroups: [""]
    resources: ["pods/eviction"]
    verbs: ["create"]  # For node drain
  # Deployment operations (k8s-deploy)
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "patch", "update"]
  # Node operations (k8s-node)
  - apiGroups: [""]
    resources: ["nodes"]
    verbs: ["get", "list", "patch"]
  # Service operations (k8s-svc)
  - apiGroups: [""]
    resources: ["services", "endpoints"]
    verbs: ["get", "list"]
  # ConfigMap/Secret operations (k8s-config)
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["secrets"]
    verbs: ["get", "list", "create", "delete"]
  # Ingress operations (k8s-ingress)
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "create", "update", "patch", "delete"]
  # Storage operations (k8s-storage)
  - apiGroups: [""]
    resources: ["persistentvolumeclaims"]
    verbs: ["get", "list", "create", "patch", "delete"]
  - apiGroups: [""]
    resources: ["persistentvolumes"]
    verbs: ["get", "list"]
  - apiGroups: ["storage.k8s.io"]
    resources: ["storageclasses"]
    verbs: ["get", "list"]
  # Namespace operations (k8s-namespace)
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["get", "list", "create", "patch", "delete"]
  - apiGroups: [""]
    resources: ["resourcequotas", "limitranges"]
    verbs: ["get", "list", "create", "update"]
  # Event operations (k8s-events, k8s-event-analysis)
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list"]
  # Metrics operations (k8s-metrics)
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods", "nodes"]
    verbs: ["get", "list"]
```

## Development

Build the plugin:

```bash
npm run build
```

Run tests:

```bash
npm test
```

## Safety Notes

- The **restart** action deletes pods. Use with caution in production.
- The **delete namespace** action removes all resources within the namespace. This is irreversible.
- Secret data is partially masked by default. Use the `key` parameter to retrieve specific values.
- PVC deletion may cause data loss if the reclaim policy is `Delete`.
- Always verify namespace and resource name before destructive operations.
- Consider implementing approval workflows for production operations.

## Troubleshooting

### "Forbidden" Error

Check RBAC permissions in your kubeconfig. The service account needs appropriate roles.

### "Unable to connect to cluster"

Verify kubeconfig path and cluster accessibility:

```bash
kubectl cluster-info
```

### "No resources found"

Check if namespace exists:

```bash
kubectl get namespaces
```

## Future Enhancements

- [ ] Support for multiple kubeconfig files
- [ ] Interactive pod selection (fuzzy search)
- [ ] Log streaming (real-time tail)
- [x] Resource metrics integration (kubectl top)
- [x] ConfigMap/Secret management
- [x] Port forwarding
- [x] PVC/PV/StorageClass management
- [x] Namespace management
- [x] Ingress management
- [x] HPA (Horizontal Pod Autoscaler) management
- [x] StatefulSet / DaemonSet / Job / CronJob management
- [x] RBAC / NetworkPolicy / Security audit
- [x] Helm / Gateway API / Troubleshooting
- [x] Cluster health check and topology analysis
- [x] Cost analysis and optimization
- [x] Host system monitoring via SSH
- [ ] Integration with Prometheus for metrics
- [ ] Alert integration (auto-respond to pod failures)

## Contributing

This plugin is part of your local OpenClaw installation. Customize it as needed for your infrastructure.
