---
name: sys-monitor
description: |
  System resource monitoring via SSH. Activate when user mentions CPU, memory, disk, network, load, process monitoring, or system resource status on hosts.
---

# System Monitor Tool

Single tool `sys_monitor` with action parameter for host-level resource monitoring via SSH.

## Prerequisites

Configure target hosts in plugin config:

```json
{
  "hosts": [
    { "name": "master-1", "host": "172.16.190.101", "username": "root", "privateKeyPath": "~/.ssh/id_rsa" },
    { "name": "worker-1", "host": "172.16.190.111", "username": "ops", "password": "secret" }
  ]
}
```

## Actions

### Overview

Quick system overview for a host:

```json
{
  "action": "overview",
  "host": "master-1"
}
```

Returns: hostname, uptime, CPU cores, load average, memory usage, swap, disk usage summary.

### CPU

Detailed CPU information:

```json
{
  "action": "cpu",
  "host": "master-1"
}
```

Returns: CPU architecture, model, per-core usage (via mpstat). Falls back to `top` if mpstat is not installed.

### Memory

Detailed memory breakdown:

```json
{
  "action": "memory",
  "host": "master-1"
}
```

Returns: Physical memory (total/used/free/available), swap usage, buffer/cache breakdown from `/proc/meminfo`.

### Disk

Disk usage and IO statistics:

```json
{
  "action": "disk",
  "host": "master-1"
}
```

Returns: Filesystem usage (`df -h`), inode usage (`df -i`), IO statistics (via iostat). Falls back to df-only if iostat is not installed.

### Network

Network interface and connection statistics:

```json
{
  "action": "network",
  "host": "master-1"
}
```

Returns: Connection summary (via ss), interface traffic bytes/packets from `/proc/net/dev`, IP addresses. Falls back to netstat if ss is not installed.

### Load

System load average with assessment:

```json
{
  "action": "load",
  "host": "master-1"
}
```

Returns: 1/5/15 minute load averages, per-CPU load ratio, health assessment (normal/warning/overloaded). Includes sar historical data if available.

### Process

Top processes by resource usage:

```json
{
  "action": "process",
  "host": "master-1",
  "sort_by": "cpu",
  "top_n": 15
}
```

Parameters:
- `sort_by`: Sort by `cpu` (default) or `memory`
- `top_n`: Number of processes to return (1-50, default: 15)

Returns: Top N processes with CPU%, MEM%, command. Also shows total process count and zombie process count.

## Command Degradation

The tool automatically detects available commands and falls back gracefully:

| Primary | Fallback | Affected Actions |
|---------|----------|-----------------|
| mpstat  | top      | cpu             |
| iostat  | df only  | disk            |
| sar     | uptime   | load            |
| ss      | netstat  | network         |

## Common Workflows

### Quick Health Check

```json
{ "action": "overview", "host": "master-1" }
```

### Investigate High CPU

1. Check load:
   ```json
   { "action": "load", "host": "master-1" }
   ```
2. Find CPU-heavy processes:
   ```json
   { "action": "process", "host": "master-1", "sort_by": "cpu", "top_n": 10 }
   ```
3. Get CPU details:
   ```json
   { "action": "cpu", "host": "master-1" }
   ```

### Investigate Memory Pressure

1. Check memory:
   ```json
   { "action": "memory", "host": "master-1" }
   ```
2. Find memory-heavy processes:
   ```json
   { "action": "process", "host": "master-1", "sort_by": "memory", "top_n": 10 }
   ```

### Disk Space Alert

1. Check disk usage and inodes:
   ```json
   { "action": "disk", "host": "master-1" }
   ```

## Examples

### Daily Operations

"Check the system status of master-1"
"How much memory is left on worker-1?"
"Show me disk usage on all nodes"

### Troubleshooting

"master-1 is slow, what's going on?"
Agent will:
1. Check overview for quick assessment
2. Check load average
3. List top processes by CPU
4. Report findings and suggest remediation

"Is there a memory leak on worker-2?"
Agent will:
1. Check memory details
2. List top memory consumers
3. Compare with expected baseline

## Error Handling

Common errors and solutions:

- **"Host not found"**: Verify host name matches plugin config
- **"SSH connection failed"**: Check network, credentials, SSH key
- **"Command timeout"**: Host may be under extreme load, try again
- **"Permission denied"**: Ensure SSH user has read access to /proc
