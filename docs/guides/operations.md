# Operations Handbook

This document is the single operations guide for the repository. It replaces the older split between generic scenarios and environment-specific runbooks.

## Core Workflows

### 1. Daily Health Check

Use this when you want a fast answer to "is the cluster healthy?"

Manual checks:

```bash
kubectl get nodes -o wide
kubectl get pods -n kube-system
kubectl get events -A --sort-by=.lastTimestamp | tail -n 50
```

If you run etcd and load balancers separately, also verify:

```bash
etcdctl endpoint health
curl -k https://<harbor>/api/v2.0/health
```

Typical agent prompt:

```text
执行 K8s 集群晨检
```

The agent should summarize node readiness, unhealthy system pods, warning events, and any immediate follow-up items.

### 2. Deploy or Update an Application

Use a controller-level workflow rather than restarting individual pods.

Typical agent prompts:

```text
Deploy payment-service v2.3.0 to production
把 development 命名空间的 nginx-web 更新到 nginx:1.22
```

Expected flow:

1. Inspect the current Deployment
2. Update the image or manifest
3. Watch rollout status
4. Verify new pods are ready
5. Sample logs if the change is high risk

### 3. Roll Back Quickly

When a rollout is unhealthy, prefer rollback over prolonged manual inspection.

Typical agent prompt:

```text
刚才的更新有问题，立即回滚 nginx-web
```

Expected flow:

1. Read rollout history
2. Undo to the previous revision
3. Watch rollout completion
4. Confirm pod readiness and restart counts

### 4. Scale for Traffic

Typical agent prompts:

```text
Scale frontend to 50 replicas
把 nginx-web 缩回 3 个副本
```

Before scaling up, check:

- current replica count
- basic node capacity
- whether the workload already has failures or restarts

### 5. Troubleshoot a Failing Pod

Typical agent prompts:

```text
The checkout-service pod has restarted 47 times today. Find out why
development 命名空间有个 Pod 一直重启，帮我看看
```

Expected flow:

1. Find the affected pod or label group
2. Check current status
3. Read current logs
4. Read previous logs if the container crashed
5. Describe the pod for events
6. Summarize the most likely root cause

Common diagnoses:

- `OOMKilled`: raise limits only after confirming a real capacity need
- `ImagePullBackOff`: verify image name, registry access, and credentials
- `CrashLoopBackOff`: use previous logs and events together

### 6. Node Maintenance

Typical agent prompts:

```text
我要维护 k8s-node2，帮我安全地驱逐 Pod
检查新节点 k8s-node4 是否正常加入集群
```

Safe maintenance flow:

```bash
kubectl cordon <node>
kubectl drain <node> --ignore-daemonsets --delete-emptydir-data
# perform maintenance
kubectl uncordon <node>
```

After maintenance, verify node readiness and that critical pods reschedule successfully.

## Recommended Operations Sequence

For most production changes, use this order:

1. Inspect current state
2. Make one controlled change
3. Watch rollout or recovery
4. Verify pods, events, and logs
5. Roll back quickly if health regresses

## Minimal Prompt Set

These prompts cover most daily operations:

```text
执行 K8s 集群晨检
列出 production 中异常的 Pod
部署 payment-service v2.3.0 到 production
回滚 payment-service 到上一个版本
把 frontend 扩容到 20 个副本
帮我排查 checkout-service 为什么一直重启
我要维护 k8s-node2，帮我准备
```

## Related Docs

- [getting-started.md](getting-started.md)
- [integrations.md](integrations.md)
- [../../examples/TEST-GUIDE.md](../../examples/TEST-GUIDE.md)
- [../archive/week1-practice.md](../archive/week1-practice.md)
