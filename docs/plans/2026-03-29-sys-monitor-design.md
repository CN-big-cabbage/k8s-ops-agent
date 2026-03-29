# sys-monitor Skill 设计文档

> 日期：2026-03-29
> 版本：v1.8.0
> 状态：已确认

---

## 目标

扩展 k8s-ops-agent 插件，新增 `sys-monitor` skill，通过 SSH 直连目标主机采集基础资源指标（CPU、内存、磁盘、IO、网络、负载、进程），支持金融行业生产环境的主机级别运维监控。

---

## 架构

```
OpenClaw (自然语言)
    │
    ▼
k8s-ops-agent (插件 v1.8.0)
    ├── skills/k8s-*           (已有 31 个 K8s skill)
    ├── skills/sys-monitor/    (新增：主机资源监控)
    │   ├── SKILL.md
    │   └── src/
    │       ├── monitor.ts
    │       └── monitor.test.ts
    └── lib/
        ├── client.ts          (已有：K8s client)
        ├── ssh.ts             (新增：SSH 连接管理)
        ├── types.ts           (扩展：HostConfig 类型)
        ├── format.ts          (已有：输出格式化)
        └── errors.ts          (已有：错误处理)
```

---

## SSH 连接管理

### 依赖

新增 npm 包：

```json
{
  "ssh2": "^1.16.0",
  "@types/ssh2": "^1.15.0"
}
```

### 配置方式

在 OpenClaw 插件配置中扩展 `hosts` 字段：

```json
{
  "plugins": {
    "entries": {
      "k8s": {
        "enabled": true,
        "kubeconfigPath": "/path/to/kubeconfig",
        "hosts": [
          {
            "name": "master-1",
            "host": "172.16.190.101",
            "port": 22,
            "username": "root",
            "privateKeyPath": "~/.ssh/id_rsa"
          },
          {
            "name": "worker-1",
            "host": "172.16.190.111",
            "port": 22,
            "username": "ops",
            "password": "encrypted-or-env-ref"
          }
        ]
      }
    }
  }
}
```

### 认证优先级

1. **私钥文件**（`privateKeyPath`） — 推荐，生产环境标准
2. **密码**（`password`） — 备选，配置时提示安全风险
3. **SSH Agent** — 自动检测系统 SSH Agent 转发

### 连接池

- 使用 `Map<string, Client>` 缓存已建立的 SSH 连接
- 连接空闲超过 5 分钟自动关闭
- 连接断开时自动从池中移除并在下次使用时重建
- 并发安全：同一主机不重复建连

### lib/ssh.ts 接口

```typescript
interface HostConfig {
  name: string;
  host: string;
  port?: number;           // 默认 22
  username: string;
  password?: string;
  privateKeyPath?: string;
}

interface SshManager {
  // 执行远程命令，返回 stdout
  exec(hostNameOrIp: string, command: string, timeoutMs?: number): Promise<string>;
  // 列出已配置的主机
  listHosts(): HostConfig[];
  // 关闭所有连接
  closeAll(): void;
}
```

---

## Action 设计

### 总览

| # | Action | 说明 | 远程命令 |
|---|--------|------|---------|
| 1 | overview | 主机综合概览 | `uptime` + `free -b` + `df -h` + `nproc` |
| 2 | cpu | CPU 使用详情 | `mpstat -P ALL 1 1`、`nproc`、`lscpu` |
| 3 | memory | 内存使用详情 | `free -b`、`cat /proc/meminfo`、`swapon -s` |
| 4 | disk | 磁盘使用与 IO | `df -h`、`iostat -x 1 1`、`df -i` |
| 5 | network | 网络状态 | `ss -s`、`cat /proc/net/dev`、`ip addr` |
| 6 | load | 系统负载 | `uptime`、`sar -q 1 5`（需 sysstat） |
| 7 | process | 进程 Top N | `ps aux --sort=-%cpu` 或 `--sort=-%mem` |

### Zod Schema

```typescript
const SysMonitorSchema = z.object({
  action: z.enum([
    "overview",
    "cpu",
    "memory",
    "disk",
    "network",
    "load",
    "process",
  ]),
  host: z.string().describe("目标主机名称（如 master-1）或 IP 地址"),
  sort_by: z
    .enum(["cpu", "memory"])
    .optional()
    .default("cpu")
    .describe("process action 的排序方式"),
  top_n: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(15)
    .describe("process action 返回前 N 个进程"),
});
```

### 各 Action 详细设计

#### 1. overview（综合概览）

采集命令：

```bash
# 主机名 + 运行时间 + 负载
hostname && uptime

# CPU 核心数
nproc

# 内存
free -b

# 磁盘
df -h --total
```

输出格式：

```
=== 主机概览: master-1 (172.16.190.101) ===

主机名:    k8s-master-01
运行时间:  45 days, 3:22
CPU 核心:  8

负载 (1/5/15 min):  1.23 / 0.98 / 0.87

内存:
  总量: 32.0 GB | 已用: 18.5 GB (57.8%) | 可用: 13.5 GB

磁盘:
  /         50G    35G   15G   70%
  /data    200G   120G   80G   60%
  合计     250G   155G   95G   62%
```

#### 2. cpu（CPU 详情）

采集命令：

```bash
# CPU 架构信息
lscpu | grep -E "^(Architecture|Model name|CPU\(s\)|Thread|Core|Socket)"

# 每核使用率（采样 1 秒）
mpstat -P ALL 1 1
```

输出格式：

```
=== CPU 详情: master-1 ===

架构:     x86_64
型号:     Intel Xeon E5-2680 v4
核心数:   8 (4 cores x 2 threads)

CPU    %usr   %sys   %iowait  %idle
ALL    23.5    5.2     1.3     70.0
  0    45.2    8.1     0.5     46.2
  1    12.3    3.4     2.1     82.2
  ...
```

> 降级策略：如果 `mpstat` 不可用（未安装 sysstat），使用 `top -bn1 | head -5` + `/proc/stat` 作为替代。

#### 3. memory（内存详情）

采集命令：

```bash
free -b
cat /proc/meminfo | grep -E "(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree)"
swapon -s
```

输出格式：

```
=== 内存详情: master-1 ===

物理内存:
  总量:   32.0 GB
  已用:   18.5 GB (57.8%)
  空闲:    2.1 GB
  可用:   13.5 GB (42.2%)
  缓存:   11.4 GB (Buffers + Cached)

Swap:
  总量:   4.0 GB
  已用:   0.2 GB (5.0%)
  空闲:   3.8 GB
```

#### 4. disk（磁盘与 IO）

采集命令：

```bash
# 磁盘使用
df -h

# inode 使用
df -i

# IO 统计（采样 1 秒）
iostat -x 1 1
```

输出格式：

```
=== 磁盘详情: master-1 ===

挂载点        大小    已用    可用   使用率  inode使用率
/             50G    35G    15G    70%     12%
/data        200G   120G    80G    60%      3%

IO 统计:
设备      rrqm/s  wrqm/s    r/s    w/s   rMB/s  wMB/s  await  %util
sda         0.12    5.43   12.3   45.6    0.5    2.3    1.2    8.5%
sdb         0.00    0.21    3.1    8.9    0.1    0.4    0.8    3.2%
```

> 降级策略：如果 `iostat` 不可用，跳过 IO 统计部分，仅返回 `df` 数据。

#### 5. network（网络状态）

采集命令：

```bash
# 连接统计
ss -s

# 接口流量
cat /proc/net/dev

# IP 地址
ip -brief addr
```

输出格式：

```
=== 网络详情: master-1 ===

连接统计:
  TCP:  established 236, time_wait 45, close_wait 3
  UDP:  12 active

网络接口:
  接口      状态   IP               RX (MB/s)  TX (MB/s)
  eth0      UP    172.16.190.101    12.5        8.3
  lo        UP    127.0.0.1          0.1        0.1
```

#### 6. load（系统负载）

采集命令：

```bash
# 当前负载
uptime
nproc

# 负载趋势（需要 sysstat）
sar -q 1 5
```

输出格式：

```
=== 系统负载: master-1 ===

当前负载:
  1 min:   1.23
  5 min:   0.98
  15 min:  0.87
  CPU 核心: 8
  负载/核心: 0.15 (健康)

负载评估: ✓ 正常（< 0.7/核心）

趋势 (最近 5 秒采样):
  时间      runq-sz  plist-sz  ldavg-1  ldavg-5
  14:30:01    2       312      1.23     0.98
  14:30:02    1       312      1.22     0.98
  ...
```

> 负载/核心阈值：< 0.7 正常, 0.7-1.0 注意, > 1.0 告警

> 降级策略：如果 `sar` 不可用，仅返回 `uptime` 的负载数据，不展示趋势。

#### 7. process（进程 Top N）

采集命令：

```bash
# 按 CPU 排序
ps aux --sort=-%cpu | head -N

# 按内存排序
ps aux --sort=-%mem | head -N
```

输出格式：

```
=== 进程 Top 15 (按 CPU): master-1 ===

  PID   USER     %CPU  %MEM     RSS    COMMAND
 1234   root     45.2   3.1   1.0 GB   kube-apiserver
 2345   root     12.8   8.5   2.7 GB   etcd
 3456   nobody    8.3   1.2   0.4 GB   nginx: worker process
  ...

总计: 312 个进程, 2 个僵尸进程
```

---

## 命令降级策略

主机环境差异较大，部分命令可能不存在。采用 graceful degradation：

| 命令 | 依赖 | 降级替代 |
|------|------|---------|
| `mpstat` | sysstat | `top -bn1` + `/proc/stat` |
| `iostat` | sysstat | 跳过 IO 部分，仅显示 `df` |
| `sar` | sysstat | 仅显示 `uptime` 负载，不展示趋势 |
| `ss` | iproute2 | `netstat -s`（较旧系统） |
| `ip` | iproute2 | `ifconfig` |

实现方式：先执行 `which <cmd>` 检测可用性，不可用时自动切换到替代命令。

---

## 错误处理

| 场景 | 处理 |
|------|------|
| SSH 连接失败 | 返回明确错误：连接超时/认证失败/主机不可达 |
| 主机名未在配置中找到 | 提示可用主机列表 |
| 命令执行超时（默认 10s） | 中断并返回已采集的部分数据 |
| 命令不存在 | 使用降级替代方案 |
| 输出超长 | 截断到 MAX_OUTPUT_BYTES（10KB） |

---

## 安全考量

1. **凭证存储**：推荐使用私钥认证；如用密码，建议通过环境变量引用（`$ENV_VAR`）而非明文
2. **命令白名单**：所有远程执行的命令硬编码在代码中，不接受用户自定义命令
3. **只读操作**：所有 action 仅执行只读命令，不修改主机状态
4. **输出过滤**：避免在输出中暴露敏感信息（如 `/proc/meminfo` 中的内核地址）

---

## 注册与配置

### openclaw.plugin.json 扩展

```json
{
  "id": "k8s",
  "skills": ["./skills"],
  "configSchema": {
    "type": "object",
    "properties": {
      "kubeconfigPath": { "type": "string" },
      "defaultContext": { "type": "string" },
      "hosts": {
        "type": "array",
        "description": "SSH target hosts for sys-monitor skill",
        "items": {
          "type": "object",
          "required": ["name", "host", "username"],
          "properties": {
            "name": { "type": "string" },
            "host": { "type": "string" },
            "port": { "type": "number", "default": 22 },
            "username": { "type": "string" },
            "password": { "type": "string" },
            "privateKeyPath": { "type": "string" }
          }
        }
      }
    }
  }
}
```

### index.ts 注册

```typescript
import { registerSysMonitorTools } from "./skills/sys-monitor/src/monitor.js";

// 在 load() 中添加:
registerSysMonitorTools(api);
api.log("K8s plugin loaded successfully - 32 skills registered");
```

---

## 测试计划

### 单元测试

- Zod schema 验证（各 action + 参数组合）
- 命令输出解析（mock SSH 输出 → 格式化结果）
- 降级策略逻辑（命令不存在时的替代行为）
- 错误处理（连接失败、超时、未知主机）

### 集成测试

- 真实 SSH 连接到测试主机
- 7 个 action 全部执行并验证输出格式
- 连接池复用验证

---

## 使用示例

```
"查看 master-1 的资源概览"
"172.16.190.111 的 CPU 使用情况"
"worker-1 的磁盘使用率和 IO"
"master-1 上最占内存的 10 个进程"
"检查所有节点的负载情况"
"worker-2 的网络连接状态"
"master-1 内存够用吗？"
```
