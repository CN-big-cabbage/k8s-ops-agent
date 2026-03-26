---
name: k8s-storage
description: |
  Kubernetes PersistentVolume and PersistentVolumeClaim operations. Activate when user mentions storage, PVC, PV, volumes, disk, capacity, or storage management.
---

# Kubernetes Storage Tool

Single tool `k8s_storage` with action parameter for storage operations.

## Actions

### List PersistentVolumeClaims

List all PVCs in a namespace:

```json
{
  "action": "list_pvc",
  "namespace": "default"
}
```

List PVCs across all namespaces:

```json
{
  "action": "list_pvc",
  "all_namespaces": true
}
```

Filter by status:

```json
{
  "action": "list_pvc",
  "namespace": "production",
  "status": "Pending"
}
```

Filter by storage class:

```json
{
  "action": "list_pvc",
  "namespace": "default",
  "storage_class": "gp2"
}
```

Returns: PVC names, status, capacity, storage class, age.

### Describe PVC

Get detailed information about a PVC:

```json
{
  "action": "describe_pvc",
  "namespace": "default",
  "pvc_name": "data-pvc"
}
```

Returns: Full PVC details including access modes, volume mode, resources, and mount info.

### Get PVC Capacity

Get capacity information:

```json
{
  "action": "capacity_pvc",
  "namespace": "default",
  "pvc_name": "data-pvc"
}
```

Returns: Requested size, allocated size, usage percentage.

### List PersistentVolumes

List all PVs in the cluster:

```json
{
  "action": "list_pv"
}
```

Filter by storage class:

```json
{
  "action": "list_pv",
  "storage_class": "gp2"
}
```

Returns: PV names, capacity, storage class, status, claim ref, age.

### Describe PV

Get detailed information about a PersistentVolume:

```json
{
  "action": "describe_pv",
  "pv_name": "pv-data-001"
}
```

Returns: Full PV details including capacity, access modes, reclaim policy, storage class, and mount info.

### Get Storage Class Info

Get storage class details:

```json
{
  "action": "describe_storage_class",
  "storage_class": "gp2"
}
```

Returns: Provisioner, parameters, reclaim policy, volume binding mode.

### List Storage Classes

List all storage classes:

```json
{
  "action": "list_storage_class"
}
```

Returns: Storage class names, provisioners, reclaim policies.

### Create PVC

Create a new PersistentVolumeClaim:

```json
{
  "action": "create_pvc",
  "namespace": "default",
  "pvc_name": "my-data-pvc",
  "storage_request": "10Gi",
  "storage_class": "gp2",
  "access_modes": ["ReadWriteOnce"]
}
```

With specific access mode:

```json
{
  "action": "create_pvc",
  "namespace": "default",
  "pvc_name": "shared-pvc",
  "storage_request": "100Gi",
  "storage_class": "efs",
  "access_modes": ["ReadWriteMany"]
}
```

### Delete PVC

Delete a PersistentVolumeClaim:

```json
{
  "action": "delete_pvc",
  "namespace": "default",
  "pvc_name": "old-pvc"
}
```

**Warning**: Deleting a PVC may cause data loss!

### Storage Usage Report

Get cluster-wide storage usage:

```json
{
  "action": "usage_report"
}
```

Returns: Total capacity, used, available per storage class.

### Find Pods Using PVC

Find pods using a specific PVC:

```json
{
  "action": "find_pods",
  "namespace": "default",
  "pvc_name": "data-pvc"
}
```

### Resize PVC

Request PVC size increase (if storage class supports):

```json
{
  "action": "resize_pvc",
  "namespace": "default",
  "pvc_name": "data-pvc",
  "new_size": "20Gi"
}
```

## Access Modes

- **ReadWriteOnce (RWO)** - Single node read/write
- **ReadOnlyMany (ROX)** - Multiple nodes read-only
- **ReadWriteMany (RWX)** - Multiple nodes read/write

## Volume Modes

- **Filesystem** (default) - Regular filesystem
- **Block** - Raw block device

## Common Workflows

### Check Storage Issues

1. List PVCs with problems:
   ```json
   { "action": "list_pvc", "namespace": "production", "status": "Pending" }
   ```

2. Describe problematic PVC:
   ```json
   { "action": "describe_pvc", "namespace": "production", "pvc_name": "data-pvc" }
   ```

3. Check PV:
   ```json
   { "action": "describe_pv", "pv_name": "pv-xxx" }
   ```

### Find Storage-Hungry Pods

1. Get storage usage:
   ```json
   { "action": "usage_report" }
   ```

2. Find pods using large PVCs:
   ```json
   { "action": "list_pvc", "namespace": "production" }
   ```

3. Check capacity:
   ```json
   { "action": "capacity_pvc", "namespace": "production", "pvc_name": "large-pvc" }
   ```

### Troubleshoot PVC Pending

1. Describe PVC:
   ```json
   { "action": "describe_pvc", "namespace": "production", "pvc_name": "new-pvc" }
   ```

2. Check events:
   Use k8s-events to check for storage events

3. Check storage class:
   ```json
   { "action": "describe_storage_class", "storage_class": "gp3" }
   ```

### Capacity Planning

1. Get usage report:
   ```json
   { "action": "usage_report" }
   ```

2. List PVs:
   ```json
   { "action": "list_pv" }
   ```

3. Check storage classes:
   ```json
   { "action": "list_storage_class" }
   ```

## Storage Classes

Common cloud provider storage classes:

- **AWS**: gp2, gp3, io1, io2, st1, sc1
- **GCP**: standard, balanced, ssd, extreme
- **Azure**: Standard_LRS, Premium_LRS, StandardSSD_LRS

## Safety Notes

- **Delete operations** are irreversible - all data will be lost
- **Resize** requires storage class to support expansion
- Some PVs have Retain reclaim policy - data persists after PVC deletion
- Check access modes match pod requirements

## Permissions Required

The kubeconfig must have the following RBAC permissions:

- `persistentvolumeclaims/list` - List PVCs
- `persistentvolumeclaims/get` - Get PVC details
- `persistentvolumeclaims/update` - Resize PVC
- `persistentvolumeclaims/create` - Create PVC
- `persistentvolumeclaims/delete` - Delete PVC
- `persistentvolumes/list` - List PVs
- `persistentvolumes/get` - Get PV details
- `storageclasses/list` - List storage classes
- `storageclasses/get` - Get storage class details

## Error Handling

Common errors and solutions:

- **"Pending"**: Check storage class exists, check cluster capacity
- **"VolumeModeMismatch"**: Check PVC and PV volume modes match
- **"StorageClassNotFound"**: Verify storage class name
- **"Forbidden"**: Check RBAC permissions
- **"ClaimBound"**: Cannot delete - PV is bound

## Examples

### Daily Operations

"List all PVCs in production"
"Show me the data-pvc details"
"What storage classes are available"

### Troubleshooting

"Why is my PVC pending?"
Agent will:
1. Describe the PVC
2. Check storage class
3. Look for storage events
4. Suggest remediation

"The database pod can't start, check storage"
Agent will:
1. Find PVC for the pod
2. Check PVC status
3. Check capacity
4. Verify PV is bound

### Management

"Create a new 50Gi PVC for the database"
"Increase the data-pvc to 100Gi"
"Delete the old backup-pvc"