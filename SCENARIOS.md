# K8s Plugin - Real-World Scenarios

This document demonstrates how to use k8s-pod and k8s-deploy skills together for common operations scenarios.

## Scenario 1: Deploy New Application Version

### Context
You need to deploy a new version of the payment-service to production.

### Conversation Flow

**You:** "Deploy payment-service v2.3.0 to production"

**Agent:**
1. Checks current deployment status:
   ```json
   { "action": "describe", "namespace": "production", "deployment_name": "payment-service" }
   ```

2. Updates the image:
   ```json
   {
     "action": "update_image",
     "namespace": "production",
     "deployment_name": "payment-service",
     "container": "payment",
     "image": "payment-service:v2.3.0"
   }
   ```

3. Monitors rollout:
   ```json
   { "action": "rollout_status", "namespace": "production", "deployment_name": "payment-service" }
   ```

4. Checks pod status:
   ```json
   { "action": "list", "namespace": "production", "label_selector": "app=payment-service" }
   ```

**Agent Response:**
```
Deployment updated successfully:
- Image: payment-service:v2.3.0
- Rollout: 3/3 replicas updated and ready
- All pods are Running
- New pods started: 15s, 18s, 22s ago
```

---

## Scenario 2: Emergency Rollback

### Context
The new version is causing errors. You need to rollback immediately.

### Conversation Flow

**You:** "The payment service is throwing errors! Roll it back NOW"

**Agent:**
1. Checks rollout history:
   ```json
   { "action": "rollout_history", "namespace": "production", "deployment_name": "payment-service" }
   ```

2. Performs rollback:
   ```json
   { "action": "rollout_undo", "namespace": "production", "deployment_name": "payment-service" }
   ```

3. Monitors rollback progress:
   ```json
   { "action": "rollout_status", "namespace": "production", "deployment_name": "payment-service" }
   ```

4. Verifies pods are healthy:
   ```json
   { "action": "status", "namespace": "production", "pod_name": "payment-service-abc123" }
   ```

**Agent Response:**
```
Emergency rollback completed:
- Rolled back to revision 7 (v2.2.1)
- Rollout status: 3/3 replicas ready
- All pods Running with 0 restarts
- Service restored in 45 seconds
```

---

## Scenario 3: Scale for Traffic Spike

### Context
Black Friday sale is starting, you need to scale up the frontend.

### Conversation Flow

**You:** "Black Friday starts in 10 minutes. Scale frontend to handle 10x traffic"

**Agent:**
1. Checks current scale:
   ```json
   { "action": "describe", "namespace": "production", "deployment_name": "frontend" }
   ```
   Current: 5 replicas

2. Scales up:
   ```json
   { "action": "scale", "namespace": "production", "deployment_name": "frontend", "replicas": 50 }
   ```

3. Monitors scaling progress:
   ```json
   { "action": "rollout_status", "namespace": "production", "deployment_name": "frontend" }
   ```

4. Lists new pods:
   ```json
   { "action": "list", "namespace": "production", "label_selector": "app=frontend" }
   ```

**Agent Response:**
```
Frontend scaled for high traffic:
- Replicas: 5 → 50
- Ready: 50/50 (all healthy)
- New pods distributed across 10 nodes
- Average startup time: 12 seconds
- System ready for traffic spike
```

---

## Scenario 4: Troubleshoot Failed Deployment

### Context
A deployment is stuck and not progressing.

### Conversation Flow

**You:** "The order-service deployment is stuck. What's wrong?"

**Agent:**
1. Checks rollout status:
   ```json
   { "action": "rollout_status", "namespace": "production", "deployment_name": "order-service" }
   ```
   Status: Progressing (ProgressDeadlineExceeded)

2. Describes deployment:
   ```json
   { "action": "describe", "namespace": "production", "deployment_name": "order-service" }
   ```
   Shows: 2/3 replicas ready, ReplicaSet created

3. Lists pods to identify problem:
   ```json
   { "action": "list", "namespace": "production", "label_selector": "app=order-service" }
   ```
   Finds: 1 pod in ImagePullBackOff

4. Gets pod details:
   ```json
   { "action": "describe", "namespace": "production", "pod_name": "order-service-new-xyz" }
   ```

5. Checks logs from failing pod:
   ```json
   { "action": "logs", "namespace": "production", "pod_name": "order-service-new-xyz", "previous": true }
   ```

**Agent Diagnosis:**
```
Deployment failed due to ImagePullBackOff:
- Issue: Image 'order-service:v3.1.0' not found in registry
- 2 pods running old version (v3.0.0)
- 1 pod failing to pull new image

Recommended actions:
1. Verify image exists: docker pull order-service:v3.1.0
2. Check registry credentials
3. Or rollback: "Roll back order-service deployment"
```

---

## Scenario 5: Routine Maintenance Restart

### Context
Memory leak suspected, need to restart all pods without downtime.

### Conversation Flow

**You:** "Restart the api-gateway deployment to clear memory leaks"

**Agent:**
1. Checks current status:
   ```json
   { "action": "describe", "namespace": "production", "deployment_name": "api-gateway" }
   ```
   Shows: 8 replicas, RollingUpdate strategy

2. Performs rolling restart:
   ```json
   { "action": "rollout_restart", "namespace": "production", "deployment_name": "api-gateway" }
   ```

3. Monitors rollout:
   ```json
   { "action": "rollout_status", "namespace": "production", "deployment_name": "api-gateway" }
   ```

4. Verifies new pods are healthy:
   ```json
   { "action": "list", "namespace": "production", "label_selector": "app=api-gateway" }
   ```

**Agent Response:**
```
Rolling restart completed:
- All 8 replicas restarted gracefully
- No downtime (rolling update maintained 6+ ready pods)
- New pods uptime: 1m, 1m, 2m, 2m, 3m, 3m, 4m, 4m
- Memory usage: ~200MB per pod (down from ~1.2GB)
- Service availability: 100% during restart
```

---

## Scenario 6: Investigate High Restart Count

### Context
Monitoring alerts show a pod restarting frequently.

### Conversation Flow

**You:** "The checkout-service pod has restarted 47 times today. Find out why"

**Agent:**
1. Lists pods with restarts:
   ```json
   { "action": "list", "namespace": "production", "label_selector": "app=checkout-service" }
   ```
   Identifies: checkout-service-abc (47 restarts)

2. Checks deployment health:
   ```json
   { "action": "describe", "namespace": "production", "deployment_name": "checkout-service" }
   ```

3. Gets pod status:
   ```json
   { "action": "status", "namespace": "production", "pod_name": "checkout-service-abc" }
   ```
   Shows: CrashLoopBackOff

4. Checks current logs:
   ```json
   { "action": "logs", "namespace": "production", "pod_name": "checkout-service-abc", "tail_lines": 50 }
   ```

5. Checks previous crash logs:
   ```json
   { "action": "logs", "namespace": "production", "pod_name": "checkout-service-abc", "previous": true }
   ```

6. Describes pod for events:
   ```json
   { "action": "describe", "namespace": "production", "pod_name": "checkout-service-abc" }
   ```

**Agent Diagnosis:**
```
Root cause identified: OOMKilled (Out of Memory)

Analysis:
- Pod memory limit: 512Mi
- Actual usage at crash: 508Mi
- Pattern: Crashes every 8-12 minutes
- Logs show: Large object allocation before crash

Events:
- 47x "OOMKilled" (container exceeded memory limit)

Recommended actions:
1. Increase memory limit to 1Gi:
   "Update checkout-service deployment memory limit to 1Gi"
2. Investigate memory leak in application code
3. Monitor after increase
```

---

## Scenario 7: Multi-Step Deployment with Validation

### Context
Deploy critical service with validation at each step.

### Conversation Flow

**You:** "Deploy payment-gateway v4.0.0 to production. Be extra careful and validate each step."

**Agent:**
1. **Pre-deployment checks:**
   ```json
   { "action": "describe", "namespace": "production", "deployment_name": "payment-gateway" }
   ```
   Current: v3.5.2, 6 replicas, all healthy

2. **Records current state:**
   ```json
   { "action": "rollout_history", "namespace": "production", "deployment_name": "payment-gateway" }
   ```
   Current revision: 12

3. **Updates image:**
   ```json
   {
     "action": "update_image",
     "namespace": "production",
     "deployment_name": "payment-gateway",
     "container": "gateway",
     "image": "payment-gateway:v4.0.0"
   }
   ```

4. **Monitors rollout (every 10 seconds):**
   ```json
   { "action": "rollout_status", "namespace": "production", "deployment_name": "payment-gateway" }
   ```

5. **Checks pod health after 2 new pods:**
   ```json
   { "action": "list", "namespace": "production", "label_selector": "app=payment-gateway" }
   ```

6. **Samples logs from new pods:**
   ```json
   { "action": "logs", "namespace": "production", "pod_name": "payment-gateway-new-xyz", "tail_lines": 20 }
   ```

**Agent Response (Success):**
```
✓ Deployment successful - payment-gateway v4.0.0

Timeline:
00:00 - Pre-check: 6/6 replicas healthy on v3.5.2
00:05 - Image updated to v4.0.0
00:10 - 2/6 replicas updated and ready
00:20 - 4/6 replicas updated and ready
00:30 - 6/6 replicas updated and ready

Validation:
✓ All pods Running (0 restarts)
✓ Logs show successful startup
✓ No error events
✓ Rollout completed in 30 seconds

Rollback available:
- Previous version: v3.5.2 (revision 12)
- Command: "Roll back payment-gateway to revision 12"
```

**Agent Response (Failure Detected):**
```
⚠ Deployment issue detected - PAUSED

Timeline:
00:00 - Pre-check: 6/6 replicas healthy on v3.5.2
00:05 - Image updated to v4.0.0
00:10 - 2/6 replicas updated, 1 CrashLoopBackOff
00:15 - ERROR: New pods failing

Issue:
- 1 new pod in CrashLoopBackOff
- Error: "Failed to connect to database: auth failed"
- Suspect: New version incompatible with current DB

ROLLBACK RECOMMENDED
Proceed with automatic rollback? [Yes/No]
```

---

## Scenario 8: Capacity Planning

### Context
Need to understand current resource usage before scaling.

### Conversation Flow

**You:** "I want to scale the recommendation-engine. Show me the current state first."

**Agent:**
1. Gets deployment details:
   ```json
   { "action": "describe", "namespace": "production", "deployment_name": "recommendation-engine" }
   ```

2. Lists all pods:
   ```json
   { "action": "list", "namespace": "production", "label_selector": "app=recommendation-engine" }
   ```

3. Samples a few pods for detailed status:
   ```json
   { "action": "status", "namespace": "production", "pod_name": "recommendation-engine-abc" }
   ```

**Agent Analysis:**
```
Current State - recommendation-engine:

Deployment:
- Replicas: 4/4 ready
- Strategy: RollingUpdate (maxSurge: 1, maxUnavailable: 0)
- Image: recommendation-engine:v1.5.0

Pods Distribution:
- node-1: 1 pod (Running, 5d uptime)
- node-2: 1 pod (Running, 5d uptime)
- node-3: 1 pod (Running, 3d uptime)
- node-4: 1 pod (Running, 3d uptime)

Resource Configuration:
- CPU Request: 500m per pod (2 cores total)
- CPU Limit: 2 per pod (8 cores total)
- Memory Request: 1Gi per pod (4Gi total)
- Memory Limit: 2Gi per pod (8Gi total)

Health:
✓ All pods Running
✓ 0 restarts in last 24h
✓ No recent events

Scaling Recommendations:
- Current capacity: 4 pods
- Safe to scale up to: 12 pods (based on cluster resources)
- For 3x traffic: Scale to 12 replicas
- For 5x traffic: Scale to 20 replicas (may need cluster expansion)

Ready to scale. How many replicas do you want?
```

---

## Combining with Heartbeat Monitoring

Add to `~/.openclaw/workspace/HEARTBEAT.md`:

```markdown
## Production Deployment Monitor (every 30 min)

- [ ] Check all production deployments for issues
  - CrashLoopBackOff pods
  - Failed rollouts
  - ImagePullBackOff
  - Deployments with replicas < desired

If issues found:
1. Alert to Feishu ops-channel with details
2. Suggest remediation actions
3. Auto-rollback if critical service affected (with approval)
```

---

## Combining with Cron Jobs

Add to `~/.openclaw/cron/jobs.json`:

```json
{
  "k8s-deployment-health": {
    "schedule": "0 */4 * * *",
    "prompt": "Check all production deployments. Report any with: 1) ready < desired replicas, 2) recent failed rollouts, 3) pods with high restart counts. Send summary to Feishu ops-channel.",
    "deliveryQueue": ["feishu:ops-group"]
  },
  "k8s-weekly-report": {
    "schedule": "0 9 * * 1",
    "prompt": "Generate weekly K8s report: 1) Deployment changes, 2) Rollback incidents, 3) Scaling events, 4) Top restarting pods. Send to Feishu management-channel.",
    "deliveryQueue": ["feishu:management"]
  }
}
```

---

## Tips for Effective Usage

### 1. Use Descriptive Prompts

❌ "Check the deployment"
✅ "Check the payment-service deployment in production for rollout issues"

### 2. Let Agent Suggest Actions

After diagnosis, the agent should suggest next steps:
- "Roll back to revision X"
- "Scale to Y replicas"
- "Check logs from pod Z"

### 3. Chain Operations

The agent should intelligently chain operations:
- Update image → Monitor rollout → Check pods → Verify logs

### 4. Safety First

For production operations, agent should:
- Show current state before changes
- Confirm destructive actions
- Monitor after changes
- Suggest rollback if issues detected

### 5. Record in MEMORY.md

After incidents, update `~/.openclaw/workspace/MEMORY.md`:

```markdown
### K8s Incident History

#### 2026-02-21: Payment Service v2.3.0 Rollback
- Deployed v2.3.0, caused database connection errors
- Rolled back to v2.2.1 after 2 minutes
- Root cause: Incompatible DB driver version
- Prevention: Add DB compatibility check to CI/CD

#### 2026-02-20: Frontend Black Friday Scaling
- Scaled from 5 to 50 replicas
- Handled 10x traffic successfully
- Scaled back to 10 after sale ended
- Note: 50 replicas is safe limit for current cluster
```
