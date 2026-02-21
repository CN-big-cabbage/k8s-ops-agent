---
name: k8s-node
description: |
  Kubernetes Node operations. Activate when user mentions nodes, node management, node maintenance, or node resources.
---

# Kubernetes Node Tool

Single tool `k8s_node` with action parameter for all node operations.

## Actions

### List Nodes

List all nodes in the cluster:

```json
{
  "action": "list"
}
```

Filter by label selector:

```json
{
  "action": "list",
  "label_selector": "node-role.kubernetes.io/master"
}
```

Returns: Node names, status, roles, age, version, and resource capacity.

### Describe Node

Get detailed information about a specific node:

```json
{
  "action": "describe",
  "node_name": "k8s-node1"
}
```

Returns: Full node details including conditions, capacity, allocatable resources, addresses, and pod list.

### Cordon Node

Mark node as unschedulable (prevents new pods from being scheduled):

```json
{
  "action": "cordon",
  "node_name": "k8s-node2"
}
```

Returns: Confirmation that node is now unschedulable.

**Use case**: Before node maintenance, prevent new pods from scheduling.

### Uncordon Node

Mark node as schedulable (allows new pods to be scheduled):

```json
{
  "action": "uncordon",
  "node_name": "k8s-node2"
}
```

Returns: Confirmation that node is now schedulable.

**Use case**: After node maintenance is complete, allow pods to schedule again.

### Drain Node

Safely evict all pods from a node (prepares node for maintenance):

```json
{
  "action": "drain",
  "node_name": "k8s-node2"
}
```

With options:

```json
{
  "action": "drain",
  "node_name": "k8s-node2",
  "ignore_daemonsets": true,
  "delete_emptydir_data": true,
  "force": false,
  "grace_period": 30
}
```

Parameters:
- `ignore_daemonsets`: Skip DaemonSet-managed pods (default: true)
- `delete_emptydir_data`: Delete pods with emptyDir volumes (default: true)
- `force`: Force deletion of pods (default: false)
- `grace_period`: Grace period for pod termination in seconds (default: 30)

Returns: List of evicted pods and status.

**Warning**: This will evict all pods from the node. Use with caution!

### Get Node Status

Quick status check for a node:

```json
{
  "action": "status",
  "node_name": "k8s-master1"
}
```

Returns: Node conditions, ready status, and resource usage summary.

### Get Node Taints

View node taints (taints prevent pods from scheduling):

```json
{
  "action": "get_taints",
  "node_name": "k8s-master1"
}
```

Returns: List of taints on the node.

### Taint Node

Add a taint to a node:

```json
{
  "action": "taint",
  "node_name": "k8s-node1",
  "key": "maintenance",
  "value": "true",
  "effect": "NoSchedule"
}
```

Effects:
- `NoSchedule`: New pods won't schedule (existing pods remain)
- `PreferNoSchedule`: Avoid scheduling new pods (soft constraint)
- `NoExecute`: New pods won't schedule, existing pods evicted

Returns: Confirmation of taint addition.

### Remove Taint

Remove a taint from a node:

```json
{
  "action": "remove_taint",
  "node_name": "k8s-node1",
  "key": "maintenance"
}
```

Returns: Confirmation of taint removal.

## Common Workflows

### Node Maintenance Workflow

1. **Cordon** the node (prevent new pods):
   ```json
   { "action": "cordon", "node_name": "k8s-node2" }
   ```

2. **Drain** the node (evict existing pods):
   ```json
   { "action": "drain", "node_name": "k8s-node2", "ignore_daemonsets": true }
   ```

3. Perform maintenance (reboot, upgrade, etc.)

4. **Uncordon** the node (allow scheduling):
   ```json
   { "action": "uncordon", "node_name": "k8s-node2" }
   ```

### Adding New Node

After physical node addition:

1. Verify node joined:
   ```json
   { "action": "list" }
   ```

2. Check node status:
   ```json
   { "action": "status", "node_name": "k8s-node4" }
   ```

3. Label node for specific workloads:
   ```json
   { "action": "label", "node_name": "k8s-node4", "labels": {"workload": "database"} }
   ```

### Troubleshooting Node Issues

1. Check node status:
   ```json
   { "action": "status", "node_name": "k8s-node1" }
   ```

2. Describe node for events:
   ```json
   { "action": "describe", "node_name": "k8s-node1" }
   ```

3. Check resource pressure conditions

## Safety Notes

- **Drain** evicts all pods - ensure workloads have multiple replicas
- **Taint with NoExecute** immediately evicts pods
- **Cordon** is safer than drain - it only prevents new pods
- Always verify node has rejoined after maintenance before uncordoning
- Master nodes should have taints to prevent workload scheduling

## Permissions Required

The kubeconfig must have the following RBAC permissions:

- `nodes/list` - List nodes
- `nodes/get` - Get node details
- `nodes/update` - Cordon, uncordon, label, taint
- `pods/list` - List pods on node (for drain)
- `pods/eviction` - Evict pods (for drain)

## Error Handling

Common errors and solutions:

- **"Cannot evict pod"**: Pod has PodDisruptionBudget, adjust budget or use --force
- **"Node not found"**: Verify node name is correct
- **"DaemonSet pod"**: Use ignore_daemonsets option
- **"Forbidden"**: Check RBAC permissions

## Examples

### Daily Operations

"List all nodes in the cluster"
"What's the status of k8s-node2?"
"Show me the details of k8s-master1"

### Maintenance

"I need to reboot k8s-node2, prepare it for maintenance"
Agent will:
1. Cordon the node
2. Drain the node
3. Confirm ready for reboot

"k8s-node2 maintenance is done, bring it back online"
Agent will:
1. Verify node is Ready
2. Uncordon the node
3. Confirm scheduling enabled

### Troubleshooting

"Why is k8s-node3 not scheduling pods?"
Agent will:
1. Check if node is cordoned
2. Check node taints
3. Check node conditions (disk pressure, memory pressure, etc.)
4. Suggest remediation
