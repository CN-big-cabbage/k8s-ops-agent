# K8s Plugin Quick Start Guide

## Step 1: Install Dependencies

```bash
cd /Users/a123/.openclaw/extensions/k8s
npm install
```

## Step 2: Enable Plugin

Add to your `~/.openclaw/openclaw.json`:

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

## Step 3: Verify Kubeconfig

Ensure you have access to a Kubernetes cluster:

```bash
kubectl config view
kubectl get pods --all-namespaces
```

If you need to set up a test cluster locally:

```bash
# Using kind (Kubernetes in Docker)
kind create cluster --name openclaw-test

# Or using minikube
minikube start
```

## Step 4: Restart OpenClaw

Restart your OpenClaw instance to load the plugin:

```bash
# Stop current instance (Ctrl+C if running in terminal)
# Then start again
openclaw start
```

## Step 5: Test the Plugin

Try these commands in chat:

### Basic Pod Listing

```
List all pods in the default namespace
```

Expected response:
```
NAMESPACE  NAME                    READY  STATUS   RESTARTS  AGE  NODE
default    nginx-deployment-abc    1/1    Running  0         5d   node-1
default    redis-master-xyz        1/1    Running  2         3d   node-2
```

### Get Pod Details

```
Describe the nginx-deployment-abc pod
```

### View Logs

```
Show me the last 50 lines of logs from the nginx-deployment-abc pod
```

### Pod Status Check

```
What's the status of pods with label app=nginx?
```

Agent will use:
```json
{ "action": "list", "namespace": "default", "label_selector": "app=nginx" }
```

### Troubleshooting Scenario

```
The payment-service-456 pod in production namespace keeps crashing. Help me debug it.
```

Agent will:
1. Check pod status
2. Get previous container logs
3. Describe pod for events
4. Suggest next steps based on findings

## Step 6: Configure TOOLS.md

Add your cluster info to `~/.openclaw/workspace/TOOLS.md`:

```markdown
### Kubernetes Clusters

- **prod-k8s** (context: prod-cluster)
  - URL: https://k8s.example.com
  - Critical namespaces: production, payment
  - SLA: 99.99%

- **staging-k8s** (context: staging-cluster)
  - URL: https://staging-k8s.example.com
  - For pre-production testing

### Common Pod Patterns

- **Payment Service**: namespace=production, label=app=payment-service
- **Order Service**: namespace=production, label=app=order-service
- **Frontend**: namespace=production, label=tier=frontend

### Restart Procedures

Before restarting production pods:
1. Check current load (use metrics tool)
2. Verify replicas > 1 (avoid downtime)
3. Monitor after restart for 5 minutes
```

## Step 7: Multi-Cluster Setup (Optional)

If you have multiple clusters, configure contexts:

```json
{
  "plugins": {
    "entries": {
      "k8s": {
        "enabled": true,
        "defaultContext": "prod-cluster"
      }
    }
  }
}
```

Then in TOOLS.md, document how to switch:

```markdown
### Switching Clusters

To target a specific cluster, mention it in your request:

- "List pods in staging cluster" → context=staging-cluster
- "Check production pods" → context=prod-cluster

Or pass context explicitly:
```json
{ "action": "list", "namespace": "default", "context": "staging-cluster" }
```
```

## Example Conversations

### Daily Morning Check

**You:** "Do a morning health check on the production cluster"

**Agent:**
1. Lists all pods in production namespace
2. Identifies any pods not in Running status
3. Checks recent events for errors
4. Summarizes findings:
   - "All 45 pods in production are healthy"
   - Or: "Warning: payment-service-abc has 3 restarts in the last hour"

### Incident Response

**You:** "The order-service API is returning 500 errors"

**Agent:**
1. Lists pods with label app=order-service
2. Checks pod status and restart counts
3. Fetches recent logs (last 100 lines)
4. Describes pod for events
5. Identifies issue: "OOMKilled - container exceeded memory limit"
6. Suggests: "Consider increasing memory limits or investigating memory leak"

### Routine Restart

**You:** "Restart the frontend deployment to pick up new config"

**Agent:**
1. Lists pods with label app=frontend
2. Confirms there are multiple replicas (safe to restart)
3. Asks for confirmation: "Found 3 frontend pods. Restart all?"
4. After approval, deletes pods one by one
5. Verifies new pods are Running

## Troubleshooting

### Plugin Not Loading

Check OpenClaw logs:

```bash
tail -f ~/.openclaw/logs/*.log | grep k8s
```

### Kubernetes API Errors

Test kubectl directly:

```bash
kubectl get pods --all-namespaces
```

If kubectl works but plugin doesn't, check kubeconfig path in plugin config.

### Permission Denied

Your kubeconfig service account needs RBAC permissions. See README.md for required roles.

## Next Steps

1. **Set up Cron Jobs** for daily health checks:

```json
{
  "daily-k8s-patrol": {
    "schedule": "0 9 * * *",
    "prompt": "Check all production pods health and report any issues to Feishu ops-channel"
  }
}
```

2. **Integrate with Alerting**:

Configure Alertmanager webhook to notify OpenClaw, which can auto-diagnose pod issues.

3. **Add More Skills**:

- k8s-deploy for deployment management
- k8s-metrics for resource monitoring
- k8s-events for anomaly detection

4. **Create Runbooks** in MEMORY.md:

Document common incident response patterns so the agent can reference them.

## Support

For issues or questions, check:
- README.md for detailed documentation
- SKILL.md for tool parameters reference
- OpenClaw logs in ~/.openclaw/logs/
