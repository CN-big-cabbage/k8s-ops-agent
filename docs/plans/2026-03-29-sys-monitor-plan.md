# sys-monitor Skill 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增 sys-monitor skill，通过 SSH 连接目标主机采集 CPU/内存/磁盘/网络/负载/进程等系统资源指标。

**Architecture:** 新增 `lib/ssh.ts` 管理 SSH 连接池，新增 `skills/sys-monitor/` 实现 7 个 action。复用已有的 `lib/format.ts` 和 `lib/errors.ts`。

**Tech Stack:** ssh2 (SSH 连接), zod (参数校验), vitest (测试)

---

## Task 1: 安装依赖并扩展类型定义

**Files:**
- Modify: `package.json`
- Modify: `lib/types.ts`

**Step 1: 安装 ssh2 依赖**

Run:
```bash
npm install ssh2
npm install -D @types/ssh2
```

**Step 2: 扩展 PluginConfig 类型**

在 `lib/types.ts` 中添加 HostConfig 和扩展 PluginConfig：

```typescript
export interface HostConfig {
  name: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
}

export interface PluginConfig {
  kubeconfigPath?: string;
  defaultContext?: string;
  hosts?: HostConfig[];
}
```

**Step 3: 扩展 openclaw.plugin.json**

在 `openclaw.plugin.json` 的 configSchema.properties 中添加 hosts 字段：

```json
"hosts": {
  "type": "array",
  "description": "SSH target hosts for sys-monitor skill",
  "items": {
    "type": "object",
    "required": ["name", "host", "username"],
    "properties": {
      "name": { "type": "string", "description": "Host display name" },
      "host": { "type": "string", "description": "IP or hostname" },
      "port": { "type": "number", "default": 22 },
      "username": { "type": "string" },
      "password": { "type": "string" },
      "privateKeyPath": { "type": "string" }
    }
  }
}
```

同时将 `additionalProperties` 改为 `true`（因为新增了 hosts）。

**Step 4: Commit**

```bash
git add package.json package-lock.json lib/types.ts openclaw.plugin.json
git commit -m "feat: add ssh2 dependency and HostConfig type for sys-monitor"
```

---

## Task 2: 实现 SSH 连接管理 (lib/ssh.ts)

**Files:**
- Create: `lib/ssh.ts`
- Create: `lib/ssh.test.ts`

**Step 1: 编写 ssh.ts 测试**

```typescript
// lib/ssh.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SshManager } from "./ssh.js";
import type { HostConfig } from "./types.js";

const testHosts: HostConfig[] = [
  { name: "master-1", host: "172.16.190.101", username: "root", privateKeyPath: "~/.ssh/id_rsa" },
  { name: "worker-1", host: "172.16.190.111", port: 2222, username: "ops", password: "test123" },
];

// Mock ssh2 module
vi.mock("ssh2", () => {
  const mockStream = {
    on: vi.fn().mockImplementation(function (this: any, event: string, cb: Function) {
      if (event === "close") {
        setTimeout(() => cb(0, undefined), 10);
      }
      if (event === "data") {
        setTimeout(() => cb(Buffer.from("mock output")), 5);
      }
      return this;
    }),
    stderr: {
      on: vi.fn().mockReturnThis(),
    },
  };

  const MockClient = vi.fn().mockImplementation(() => ({
    on: vi.fn().mockImplementation(function (this: any, event: string, cb: Function) {
      if (event === "ready") setTimeout(() => cb(), 5);
      return this;
    }),
    exec: vi.fn().mockImplementation((_cmd: string, cb: Function) => {
      cb(null, mockStream);
    }),
    end: vi.fn(),
    destroy: vi.fn(),
    connect: vi.fn(),
  }));

  return { Client: MockClient };
});

describe("SshManager", () => {
  let manager: SshManager;

  beforeEach(() => {
    manager = new SshManager(testHosts);
  });

  it("listHosts returns configured hosts", () => {
    const hosts = manager.listHosts();
    expect(hosts).toHaveLength(2);
    expect(hosts[0].name).toBe("master-1");
    expect(hosts[1].name).toBe("worker-1");
  });

  it("findHost resolves by name", () => {
    const host = manager.findHost("master-1");
    expect(host).toBeDefined();
    expect(host!.host).toBe("172.16.190.101");
  });

  it("findHost resolves by IP", () => {
    const host = manager.findHost("172.16.190.111");
    expect(host).toBeDefined();
    expect(host!.name).toBe("worker-1");
  });

  it("findHost returns undefined for unknown host", () => {
    expect(manager.findHost("unknown")).toBeUndefined();
  });

  it("exec runs command on remote host", async () => {
    const result = await manager.exec("master-1", "uptime");
    expect(result).toBe("mock output");
  });

  it("exec throws for unknown host", async () => {
    await expect(manager.exec("nonexistent", "uptime"))
      .rejects.toThrow("未找到主机");
  });
});
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run lib/ssh.test.ts`
Expected: FAIL (module not found)

**Step 3: 实现 lib/ssh.ts**

```typescript
// lib/ssh.ts
import { Client } from "ssh2";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { HostConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface PoolEntry {
  client: Client;
  lastUsed: number;
}

function expandPath(p: string): string {
  return p.startsWith("~") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

export class SshManager {
  private readonly hosts: HostConfig[];
  private readonly pool = new Map<string, PoolEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(hosts: HostConfig[]) {
    this.hosts = hosts;
    this.startCleanup();
  }

  listHosts(): ReadonlyArray<HostConfig> {
    return this.hosts;
  }

  findHost(nameOrIp: string): HostConfig | undefined {
    return this.hosts.find(
      (h) => h.name === nameOrIp || h.host === nameOrIp
    );
  }

  async exec(
    nameOrIp: string,
    command: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
  ): Promise<string> {
    const hostConfig = this.findHost(nameOrIp);
    if (!hostConfig) {
      const available = this.hosts.map((h) => `${h.name} (${h.host})`).join(", ");
      throw new Error(
        `未找到主机 "${nameOrIp}"。可用主机: ${available || "无（请在插件配置中添加 hosts）"}`
      );
    }

    const client = await this.getConnection(hostConfig);
    return this.execCommand(client, hostConfig.name, command, timeoutMs);
  }

  closeAll(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const [key, entry] of this.pool) {
      entry.client.end();
      this.pool.delete(key);
    }
  }

  private async getConnection(config: HostConfig): Promise<Client> {
    const key = `${config.host}:${config.port || 22}`;
    const existing = this.pool.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    const client = await this.connect(config);
    this.pool.set(key, { client, lastUsed: Date.now() });

    client.on("error", () => {
      this.pool.delete(key);
    });
    client.on("close", () => {
      this.pool.delete(key);
    });

    return client;
  }

  private connect(config: HostConfig): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const connectConfig: Record<string, unknown> = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        readyTimeout: DEFAULT_TIMEOUT_MS,
      };

      if (config.privateKeyPath) {
        try {
          connectConfig.privateKey = readFileSync(
            expandPath(config.privateKeyPath)
          );
        } catch (err) {
          reject(new Error(`无法读取私钥文件 ${config.privateKeyPath}: ${err}`));
          return;
        }
      } else if (config.password) {
        connectConfig.password = config.password;
      }

      client
        .on("ready", () => resolve(client))
        .on("error", (err) => {
          reject(new Error(`SSH 连接 ${config.name} (${config.host}) 失败: ${err.message}`));
        })
        .connect(connectConfig);
    });
  }

  private execCommand(
    client: Client,
    hostName: string,
    command: string,
    timeoutMs: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`[${hostName}] 命令执行超时 (${timeoutMs}ms): ${command}`));
      }, timeoutMs);

      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(new Error(`[${hostName}] 命令执行失败: ${err.message}`));
          return;
        }

        let stdout = "";
        let stderr = "";

        stream
          .on("close", (code: number) => {
            clearTimeout(timer);
            if (code !== 0 && stderr) {
              reject(new Error(`[${hostName}] 命令退出码 ${code}: ${stderr.trim()}`));
            } else {
              resolve(stdout);
            }
          })
          .on("data", (data: Buffer) => {
            stdout += data.toString();
          });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      });
    });
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.pool) {
        if (now - entry.lastUsed > IDLE_TIMEOUT_MS) {
          entry.client.end();
          this.pool.delete(key);
        }
      }
    }, 60_000);

    // Allow Node.js to exit even if timer is running
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}
```

**Step 4: 运行测试确认通过**

Run: `npx vitest run lib/ssh.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/ssh.ts lib/ssh.test.ts
git commit -m "feat: add SSH connection manager with connection pooling"
```

---

## Task 3: 实现 sys-monitor skill 核心框架 + overview action

**Files:**
- Create: `skills/sys-monitor/SKILL.md`
- Create: `skills/sys-monitor/src/monitor.ts`
- Create: `skills/sys-monitor/src/monitor.test.ts`

**Step 1: 编写 Zod schema 和 overview 的测试**

```typescript
// skills/sys-monitor/src/monitor.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock ssh module
const mockExec = vi.fn();
const mockListHosts = vi.fn().mockReturnValue([
  { name: "master-1", host: "172.16.190.101", username: "root" },
]);
const mockFindHost = vi.fn().mockReturnValue(
  { name: "master-1", host: "172.16.190.101", username: "root" }
);

vi.mock("../../../lib/ssh.js", () => ({
  SshManager: vi.fn().mockImplementation(() => ({
    exec: mockExec,
    listHosts: mockListHosts,
    findHost: mockFindHost,
    closeAll: vi.fn(),
  })),
}));

import { SysMonitorSchema } from "./monitor.js";

describe("SysMonitorSchema validation", () => {
  it("accepts valid overview action", () => {
    const result = SysMonitorSchema.safeParse({ action: "overview", host: "master-1" });
    expect(result.success).toBe(true);
  });

  it("accepts all valid actions", () => {
    const actions = ["overview", "cpu", "memory", "disk", "network", "load", "process"];
    for (const action of actions) {
      const result = SysMonitorSchema.safeParse({ action, host: "master-1" });
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid action", () => {
    const result = SysMonitorSchema.safeParse({ action: "invalid", host: "master-1" });
    expect(result.success).toBe(false);
  });

  it("requires host parameter", () => {
    const result = SysMonitorSchema.safeParse({ action: "overview" });
    expect(result.success).toBe(false);
  });

  it("accepts process action with sort_by and top_n", () => {
    const result = SysMonitorSchema.safeParse({
      action: "process",
      host: "master-1",
      sort_by: "memory",
      top_n: 10,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid sort_by", () => {
    const result = SysMonitorSchema.safeParse({
      action: "process",
      host: "master-1",
      sort_by: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects top_n out of range", () => {
    const result = SysMonitorSchema.safeParse({
      action: "process",
      host: "master-1",
      top_n: 100,
    });
    expect(result.success).toBe(false);
  });
});

describe("handleSysMonitor - overview", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  it("returns formatted overview", async () => {
    mockExec.mockImplementation((_host: string, cmd: string) => {
      if (cmd.includes("hostname")) return "k8s-master-01\n";
      if (cmd.includes("uptime")) return " 14:30:01 up 45 days,  3:22,  2 users,  load average: 1.23, 0.98, 0.87\n";
      if (cmd.includes("nproc")) return "8\n";
      if (cmd.includes("free")) {
        return "              total        used        free      shared  buff/cache   available\nMem:    34359738368 19864223744  2254857728   536870912 12240656896 14495514624\nSwap:    4294967296   209715200  4085252096\n";
      }
      if (cmd.includes("df")) {
        return "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   35G   15G  70% /\n/dev/sdb1       200G  120G   80G  60% /data\n";
      }
      return "";
    });

    const { handleSysMonitor } = await import("./monitor.js");
    const result = await handleSysMonitor(
      { action: "overview", host: "master-1" },
      { hosts: [{ name: "master-1", host: "172.16.190.101", username: "root" }] }
    );

    expect(result).toContain("master-1");
    expect(result).toContain("1.23");
    expect(result).toContain("8");
  });
});
```

**Step 2: 运行测试确认失败**

Run: `npx vitest run skills/sys-monitor/src/monitor.test.ts`
Expected: FAIL

**Step 3: 实现 monitor.ts 核心框架 + overview**

```typescript
// skills/sys-monitor/src/monitor.ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";
import { SshManager } from "../../../lib/ssh.js";
import { formatTable } from "../../../lib/format.js";
import { truncateOutput } from "../../../lib/format.js";
import type { PluginConfig, HostConfig } from "../../../lib/types.js";
import { MAX_OUTPUT_BYTES } from "../../../lib/types.js";

export const SysMonitorSchema = z.object({
  action: z.enum(["overview", "cpu", "memory", "disk", "network", "load", "process"]),
  host: z.string().describe("目标主机名称（如 master-1）或 IP"),
  sort_by: z.enum(["cpu", "memory"]).optional().default("cpu")
    .describe("process action 排序方式"),
  top_n: z.number().int().min(1).max(50).optional().default(15)
    .describe("process action 返回进程数"),
});

type SysMonitorParams = z.infer<typeof SysMonitorSchema>;

// Singleton SSH manager per config
let sshManager: SshManager | null = null;

function getManager(config?: PluginConfig): SshManager {
  if (!sshManager) {
    sshManager = new SshManager(config?.hosts || []);
  }
  return sshManager;
}

// Utility: check if a command exists on remote host
async function hasCommand(manager: SshManager, host: string, cmd: string): Promise<boolean> {
  try {
    await manager.exec(host, `which ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

// Utility: parse human-readable byte sizes
function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatPercent(used: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((used / total) * 100).toFixed(1)}%`;
}

// ─── overview ────────────────────────────────────────────

async function handleOverview(manager: SshManager, host: string): Promise<string> {
  const [hostname, uptimeOut, nprocOut, freeOut, dfOut] = await Promise.all([
    manager.exec(host, "hostname").then((s) => s.trim()),
    manager.exec(host, "uptime").then((s) => s.trim()),
    manager.exec(host, "nproc").then((s) => s.trim()),
    manager.exec(host, "free -b"),
    manager.exec(host, "df -h --total 2>/dev/null || df -h"),
  ]);

  const hostConfig = manager.findHost(host);
  const ip = hostConfig?.host || host;

  // Parse load from uptime
  const loadMatch = uptimeOut.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  const load1 = loadMatch ? loadMatch[1] : "N/A";
  const load5 = loadMatch ? loadMatch[2] : "N/A";
  const load15 = loadMatch ? loadMatch[3] : "N/A";

  // Parse uptime duration
  const upMatch = uptimeOut.match(/up\s+(.+?),\s+\d+\s+user/);
  const uptimeDuration = upMatch ? upMatch[1].trim() : "N/A";

  const cores = parseInt(nprocOut, 10) || 1;

  // Parse free output
  const freeLines = freeOut.trim().split("\n");
  const memLine = freeLines.find((l) => l.startsWith("Mem:"));
  const swapLine = freeLines.find((l) => l.startsWith("Swap:"));

  let memTotal = 0, memUsed = 0, memAvailable = 0;
  if (memLine) {
    const parts = memLine.split(/\s+/);
    memTotal = parseInt(parts[1], 10) || 0;
    memUsed = parseInt(parts[2], 10) || 0;
    memAvailable = parseInt(parts[6], 10) || memTotal - memUsed;
  }

  let swapTotal = 0, swapUsed = 0;
  if (swapLine) {
    const parts = swapLine.split(/\s+/);
    swapTotal = parseInt(parts[1], 10) || 0;
    swapUsed = parseInt(parts[2], 10) || 0;
  }

  // Parse df output (grab non-header, non-tmpfs lines)
  const dfLines = dfOut.trim().split("\n").slice(1)
    .filter((l) => !l.includes("tmpfs") && !l.includes("devtmpfs") && !l.includes("overlay"));

  // Load assessment
  const loadPerCore = parseFloat(load1) / cores;
  let loadStatus = "✓ 正常";
  if (loadPerCore >= 1.0) loadStatus = "✗ 过载";
  else if (loadPerCore >= 0.7) loadStatus = "⟳ 注意";

  let result = `=== 主机概览: ${hostConfig?.name || host} (${ip}) ===\n\n`;
  result += `主机名:     ${hostname}\n`;
  result += `运行时间:   ${uptimeDuration}\n`;
  result += `CPU 核心:   ${cores}\n\n`;

  result += `负载 (1/5/15 min):  ${load1} / ${load5} / ${load15}  (${loadStatus}, ${loadPerCore.toFixed(2)}/核)\n\n`;

  result += `内存:\n`;
  result += `  总量: ${formatBytes(memTotal)} | 已用: ${formatBytes(memUsed)} (${formatPercent(memUsed, memTotal)}) | 可用: ${formatBytes(memAvailable)} (${formatPercent(memAvailable, memTotal)})\n`;
  if (swapTotal > 0) {
    result += `  Swap: ${formatBytes(swapTotal)} | 已用: ${formatBytes(swapUsed)} (${formatPercent(swapUsed, swapTotal)})\n`;
  }

  result += `\n磁盘:\n`;
  dfLines.forEach((line) => {
    result += `  ${line}\n`;
  });

  return result;
}

// ─── cpu ─────────────────────────────────────────────────

async function handleCpu(manager: SshManager, host: string): Promise<string> {
  const hostConfig = manager.findHost(host);
  const hasMpstat = await hasCommand(manager, host, "mpstat");

  const [lscpuOut, nprocOut, cpuData] = await Promise.all([
    manager.exec(host, 'lscpu | grep -E "^(Architecture|Model name|CPU\\(s\\)|Thread|Core|Socket)"'),
    manager.exec(host, "nproc"),
    hasMpstat
      ? manager.exec(host, "mpstat -P ALL 1 1")
      : manager.exec(host, "top -bn1 | head -5"),
  ]);

  let result = `=== CPU 详情: ${hostConfig?.name || host} ===\n\n`;

  // Architecture info
  const lscpuLines = lscpuOut.trim().split("\n");
  lscpuLines.forEach((line) => {
    const [key, ...vals] = line.split(":");
    if (key && vals.length > 0) {
      result += `${key.trim()}: ${vals.join(":").trim()}\n`;
    }
  });
  result += `\n`;

  if (hasMpstat) {
    // Parse mpstat output
    const lines = cpuData.trim().split("\n");
    const dataLines = lines.filter((l) => /^\d|^Average/.test(l.trim()) || l.includes("CPU"));
    const headerLine = lines.find((l) => l.includes("%usr") || l.includes("%user"));

    if (headerLine) {
      result += `每核使用率 (采样 1 秒):\n`;
      // Find the last block (Average or second sample)
      const cpuLines = lines.filter((l) => {
        const trimmed = l.trim();
        return trimmed.match(/^(all|\d+)\s/) || trimmed.match(/^Average.*?(all|\d+)/);
      });
      const lastBlock = cpuLines.slice(-1 * (parseInt(nprocOut.trim(), 10) + 1));

      const headers = ["CPU", "%usr", "%sys", "%iowait", "%idle"];
      const rows: string[][] = [];

      lastBlock.forEach((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 12) {
          const cpu = parts.find((p) => p === "all" || /^\d+$/.test(p)) || "";
          // mpstat columns: usr, nice, sys, iowait, ..., idle
          const usr = parts[3] || "0";
          const sys = parts[5] || "0";
          const iowait = parts[6] || "0";
          const idle = parts[parts.length - 1] || "0";
          rows.push([cpu === "all" ? "ALL" : `  ${cpu}`, usr, sys, iowait, idle]);
        }
      });

      if (rows.length > 0) {
        result += formatTable(headers, rows);
      }
    }
  } else {
    result += `(mpstat 未安装，使用 top 输出)\n\n`;
    result += cpuData.trim();
  }

  return result;
}

// ─── memory ──────────────────────────────────────────────

async function handleMemory(manager: SshManager, host: string): Promise<string> {
  const hostConfig = manager.findHost(host);

  const [freeOut, meminfoOut] = await Promise.all([
    manager.exec(host, "free -b"),
    manager.exec(host, 'cat /proc/meminfo | grep -E "(MemTotal|MemFree|MemAvailable|Buffers|^Cached|SwapTotal|SwapFree|Shmem)"'),
  ]);

  let result = `=== 内存详情: ${hostConfig?.name || host} ===\n\n`;

  // Parse /proc/meminfo (in kB)
  const memInfo: Record<string, number> = {};
  meminfoOut.trim().split("\n").forEach((line) => {
    const match = line.match(/^(\w+):\s+(\d+)\s+kB/);
    if (match) {
      memInfo[match[1]] = parseInt(match[2], 10) * 1024; // convert to bytes
    }
  });

  const total = memInfo.MemTotal || 0;
  const free = memInfo.MemFree || 0;
  const available = memInfo.MemAvailable || 0;
  const buffers = memInfo.Buffers || 0;
  const cached = memInfo.Cached || 0;
  const shmem = memInfo.Shmem || 0;
  const used = total - free - buffers - cached;
  const swapTotal = memInfo.SwapTotal || 0;
  const swapFree = memInfo.SwapFree || 0;
  const swapUsed = swapTotal - swapFree;

  result += `物理内存:\n`;
  result += `  总量:   ${formatBytes(total)}\n`;
  result += `  已用:   ${formatBytes(used)} (${formatPercent(used, total)})\n`;
  result += `  空闲:   ${formatBytes(free)}\n`;
  result += `  可用:   ${formatBytes(available)} (${formatPercent(available, total)})\n`;
  result += `  缓存:   ${formatBytes(buffers + cached)} (Buffers ${formatBytes(buffers)} + Cached ${formatBytes(cached)})\n`;
  result += `  共享:   ${formatBytes(shmem)}\n`;

  if (swapTotal > 0) {
    result += `\nSwap:\n`;
    result += `  总量:   ${formatBytes(swapTotal)}\n`;
    result += `  已用:   ${formatBytes(swapUsed)} (${formatPercent(swapUsed, swapTotal)})\n`;
    result += `  空闲:   ${formatBytes(swapFree)}\n`;
  } else {
    result += `\nSwap: 未启用\n`;
  }

  return result;
}

// ─── disk ────────────────────────────────────────────────

async function handleDisk(manager: SshManager, host: string): Promise<string> {
  const hostConfig = manager.findHost(host);
  const hasIostat = await hasCommand(manager, host, "iostat");

  const [dfOut, dfInodeOut, ioOut] = await Promise.all([
    manager.exec(host, "df -h"),
    manager.exec(host, "df -i"),
    hasIostat
      ? manager.exec(host, "iostat -x 1 1")
      : Promise.resolve(""),
  ]);

  let result = `=== 磁盘详情: ${hostConfig?.name || host} ===\n\n`;

  // Parse df -h and df -i, merge inode usage
  const dfLines = dfOut.trim().split("\n");
  const inodeLines = dfInodeOut.trim().split("\n");

  // Build inode map: mountpoint -> iuse%
  const inodeMap: Record<string, string> = {};
  inodeLines.slice(1).forEach((line) => {
    const parts = line.split(/\s+/);
    if (parts.length >= 6) {
      const mount = parts[5];
      const iusePct = parts[4];
      inodeMap[mount] = iusePct;
    }
  });

  const headers = ["文件系统", "大小", "已用", "可用", "使用率", "inode", "挂载点"];
  const rows: string[][] = [];

  dfLines.slice(1).forEach((line) => {
    const parts = line.split(/\s+/);
    if (parts.length >= 6 && !line.includes("tmpfs") && !line.includes("devtmpfs")) {
      const mount = parts[5];
      rows.push([parts[0], parts[1], parts[2], parts[3], parts[4], inodeMap[mount] || "-", mount]);
    }
  });

  result += formatTable(headers, rows);

  // IO stats
  if (hasIostat && ioOut) {
    result += `\n\nIO 统计 (采样 1 秒):\n`;
    const ioLines = ioOut.trim().split("\n");
    const deviceStart = ioLines.findIndex((l) => l.includes("Device") || l.includes("设备"));
    if (deviceStart >= 0) {
      ioLines.slice(deviceStart).forEach((line) => {
        result += `${line}\n`;
      });
    }
  } else if (!hasIostat) {
    result += `\n\n(iostat 未安装，跳过 IO 统计。安装 sysstat: yum install sysstat)\n`;
  }

  return result;
}

// ─── network ─────────────────────────────────────────────

async function handleNetwork(manager: SshManager, host: string): Promise<string> {
  const hostConfig = manager.findHost(host);
  const hasSs = await hasCommand(manager, host, "ss");

  const [connOut, devOut, ipOut] = await Promise.all([
    hasSs
      ? manager.exec(host, "ss -s")
      : manager.exec(host, "netstat -s 2>/dev/null | head -20"),
    manager.exec(host, "cat /proc/net/dev"),
    manager.exec(host, "ip -brief addr 2>/dev/null || ifconfig 2>/dev/null | grep -E '(^\\w|inet )'"),
  ]);

  let result = `=== 网络详情: ${hostConfig?.name || host} ===\n\n`;

  result += `连接统计:\n`;
  result += connOut.trim().split("\n").map((l) => `  ${l}`).join("\n");
  result += `\n\n`;

  // Parse /proc/net/dev
  const devLines = devOut.trim().split("\n").slice(2); // skip header lines
  const ifHeaders = ["接口", "RX bytes", "RX packets", "TX bytes", "TX packets"];
  const ifRows: string[][] = [];

  devLines.forEach((line) => {
    const match = line.match(/^\s*(\w+):\s+(.*)/);
    if (match) {
      const iface = match[1];
      const nums = match[2].trim().split(/\s+/);
      if (nums.length >= 10) {
        ifRows.push([
          iface,
          formatBytes(parseInt(nums[0], 10) || 0),
          nums[1],
          formatBytes(parseInt(nums[8], 10) || 0),
          nums[9],
        ]);
      }
    }
  });

  result += `网络接口流量:\n`;
  result += formatTable(ifHeaders, ifRows);

  result += `\n\nIP 地址:\n`;
  result += ipOut.trim().split("\n").map((l) => `  ${l.trim()}`).join("\n");

  return result;
}

// ─── load ────────────────────────────────────────────────

async function handleLoad(manager: SshManager, host: string): Promise<string> {
  const hostConfig = manager.findHost(host);
  const hasSar = await hasCommand(manager, host, "sar");

  const [uptimeOut, nprocOut, sarOut] = await Promise.all([
    manager.exec(host, "uptime"),
    manager.exec(host, "nproc"),
    hasSar
      ? manager.exec(host, "sar -q 1 3")
      : Promise.resolve(""),
  ]);

  let result = `=== 系统负载: ${hostConfig?.name || host} ===\n\n`;

  const loadMatch = uptimeOut.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  const cores = parseInt(nprocOut.trim(), 10) || 1;

  if (loadMatch) {
    const load1 = parseFloat(loadMatch[1]);
    const load5 = parseFloat(loadMatch[2]);
    const load15 = parseFloat(loadMatch[3]);
    const perCore = load1 / cores;

    let assessment = "✓ 正常 (< 0.7/核)";
    if (perCore >= 1.0) assessment = "✗ 过载 (>= 1.0/核，需要关注)";
    else if (perCore >= 0.7) assessment = "⟳ 偏高 (0.7~1.0/核)";

    result += `当前负载:\n`;
    result += `  1 min:    ${load1.toFixed(2)}\n`;
    result += `  5 min:    ${load5.toFixed(2)}\n`;
    result += `  15 min:   ${load15.toFixed(2)}\n`;
    result += `  CPU 核心: ${cores}\n`;
    result += `  负载/核:  ${perCore.toFixed(2)}\n\n`;
    result += `负载评估: ${assessment}\n`;
  }

  if (hasSar && sarOut) {
    result += `\n负载趋势 (采样 3 秒):\n`;
    result += sarOut.trim();
  } else if (!hasSar) {
    result += `\n(sar 未安装，无法展示趋势。安装 sysstat: yum install sysstat)\n`;
  }

  return result;
}

// ─── process ─────────────────────────────────────────────

async function handleProcess(
  manager: SshManager,
  host: string,
  sortBy: "cpu" | "memory",
  topN: number
): Promise<string> {
  const hostConfig = manager.findHost(host);
  const sortFlag = sortBy === "memory" ? "-%mem" : "-%cpu";
  const sortLabel = sortBy === "memory" ? "内存" : "CPU";

  const psOut = await manager.exec(
    host,
    `ps aux --sort=${sortFlag} | head -${topN + 1}`
  );

  const zombieOut = await manager.exec(
    host,
    "ps aux | awk '{if($8==\"Z\") count++} END {print count+0}'"
  );

  const totalOut = await manager.exec(
    host,
    "ps aux --no-headers | wc -l"
  );

  let result = `=== 进程 Top ${topN} (按${sortLabel}): ${hostConfig?.name || host} ===\n\n`;

  const lines = psOut.trim().split("\n");
  if (lines.length > 1) {
    // Parse ps header and data
    const headers = ["PID", "USER", "%CPU", "%MEM", "RSS", "COMMAND"];
    const rows: string[][] = [];

    lines.slice(1).forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 11) {
        const pid = parts[1];
        const user = parts[0];
        const cpu = parts[2];
        const mem = parts[3];
        const rssKb = parseInt(parts[5], 10) || 0;
        const cmd = parts.slice(10).join(" ");
        rows.push([pid, user, cpu, mem, formatBytes(rssKb * 1024), cmd.substring(0, 60)]);
      }
    });

    result += formatTable(headers, rows);
  }

  const zombies = parseInt(zombieOut.trim(), 10) || 0;
  const total = parseInt(totalOut.trim(), 10) || 0;
  result += `\n\n总计: ${total} 个进程`;
  if (zombies > 0) {
    result += `, ${zombies} 个僵尸进程`;
  }

  return result;
}

// ─── main handler ────────────────────────────────────────

export async function handleSysMonitor(
  params: SysMonitorParams,
  config?: PluginConfig
): Promise<string> {
  const manager = getManager(config);
  const { action, host, sort_by, top_n } = params;

  try {
    let output: string;

    switch (action) {
      case "overview":
        output = await handleOverview(manager, host);
        break;
      case "cpu":
        output = await handleCpu(manager, host);
        break;
      case "memory":
        output = await handleMemory(manager, host);
        break;
      case "disk":
        output = await handleDisk(manager, host);
        break;
      case "network":
        output = await handleNetwork(manager, host);
        break;
      case "load":
        output = await handleLoad(manager, host);
        break;
      case "process":
        output = await handleProcess(manager, host, sort_by || "cpu", top_n || 15);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return truncateOutput(output, MAX_OUTPUT_BYTES);
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`[sys-monitor ${action}] ${error.message}`);
    }
    throw new Error(`[sys-monitor ${action}] Unknown error: ${String(error)}`);
  }
}

// ─── register ────────────────────────────────────────────

export function registerSysMonitorTools(api: OpenClawPluginApi) {
  api.tools.register({
    name: "sys_monitor",
    description:
      "System resource monitoring via SSH: overview, cpu, memory, disk, network, load, process. " +
      "Use for host-level metrics like CPU usage, memory, disk IO, network, load average, and top processes.",
    schema: SysMonitorSchema,
    handler: async (params: SysMonitorParams) => {
      const pluginConfig = api.getPluginConfig?.("k8s");
      return await handleSysMonitor(params, pluginConfig);
    },
  });
}
```

**Step 4: 运行测试**

Run: `npx vitest run skills/sys-monitor/src/monitor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add skills/sys-monitor/
git commit -m "feat: add sys-monitor skill with 7 actions for host resource monitoring"
```

---

## Task 4: 编写 SKILL.md 文档

**Files:**
- Create: `skills/sys-monitor/SKILL.md`

**Step 1: 创建 SKILL.md**

参照 `skills/k8s-node/SKILL.md` 风格，编写 sys-monitor 的文档，覆盖所有 7 个 action 的参数和示例。

**Step 2: Commit**

```bash
git add skills/sys-monitor/SKILL.md
git commit -m "docs: add sys-monitor SKILL.md documentation"
```

---

## Task 5: 注册 skill 并更新版本

**Files:**
- Modify: `index.ts`
- Modify: `package.json` (version → 1.8.0)

**Step 1: 在 index.ts 中注册 sys-monitor**

在最后一个 import 之后添加：

```typescript
// Phase 5: System monitoring
import { registerSysMonitorTools } from "./skills/sys-monitor/src/monitor.js";
```

在 `load()` 函数最后、`api.log` 之前添加：

```typescript
    // Phase 5: System monitoring
    registerSysMonitorTools(api);

    api.log("K8s plugin loaded successfully - 32 skills registered");
```

**Step 2: 更新 package.json 版本**

```json
"version": "1.8.0"
```

**Step 3: 运行全部测试**

Run: `npx vitest run`
Expected: ALL PASS (之前的 381 + 新增测试全部通过)

**Step 4: Commit**

```bash
git add index.ts package.json
git commit -m "feat: register sys-monitor skill, bump to v1.8.0"
```

---

## Task 6: Push 到 GitHub

```bash
git push
```

测试环境拉取后即可使用：

```bash
git pull
npm install
```
