import { z } from "zod";
import { SshManager } from "../lib/ssh.js";
import { formatTable, truncateOutput } from "../lib/format.js";
import type { PluginConfig } from "../lib/types.js";
import { MAX_OUTPUT_BYTES } from "../lib/types.js";

export const SysMonitorSchema = z.object({
  action: z.enum(["overview", "cpu", "memory", "disk", "network", "load", "process"]),
  host: z.string().describe("目标主机名称（如 master-1）或 IP"),
  sort_by: z
    .enum(["cpu", "memory"])
    .optional()
    .default("cpu")
    .describe("process action 排序方式"),
  top_n: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .default(15)
    .describe("process action 返回进程数"),
});

type SysMonitorParams = z.infer<typeof SysMonitorSchema>;

let sshManager: SshManager | null = null;

function getManager(config?: PluginConfig): SshManager {
  if (!sshManager) {
    sshManager = new SshManager(config?.hosts || []);
  }
  return sshManager;
}

// Reset manager (for testing)
export function resetManager(): void {
  if (sshManager) {
    sshManager.closeAll();
    sshManager = null;
  }
}

async function hasCommand(manager: SshManager, host: string, cmd: string): Promise<boolean> {
  try {
    await manager.exec(host, `which ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

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

export async function handleOverview(manager: SshManager, host: string): Promise<string> {
  const [hostname, uptimeOut, nprocOut, freeOut, dfOut] = await Promise.all([
    manager.exec(host, "hostname").then((s) => s.trim()),
    manager.exec(host, "uptime").then((s) => s.trim()),
    manager.exec(host, "nproc").then((s) => s.trim()),
    manager.exec(host, "free -b"),
    manager.exec(host, "df -h --total 2>/dev/null || df -h"),
  ]);

  const hostConfig = manager.findHost(host);
  const ip = hostConfig?.host || host;

  const loadMatch = uptimeOut.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  const load1 = loadMatch ? loadMatch[1] : "N/A";
  const load5 = loadMatch ? loadMatch[2] : "N/A";
  const load15 = loadMatch ? loadMatch[3] : "N/A";

  const upMatch = uptimeOut.match(/up\s+(.+?),\s+\d+\s+user/);
  const uptimeDuration = upMatch ? upMatch[1].trim() : "N/A";

  const cores = parseInt(nprocOut, 10) || 1;

  const freeLines = freeOut.trim().split("\n");
  const memLine = freeLines.find((l) => l.startsWith("Mem:"));
  const swapLine = freeLines.find((l) => l.startsWith("Swap:"));

  let memTotal = 0,
    memUsed = 0,
    memAvailable = 0;
  if (memLine) {
    const parts = memLine.split(/\s+/);
    memTotal = parseInt(parts[1], 10) || 0;
    memUsed = parseInt(parts[2], 10) || 0;
    memAvailable = parseInt(parts[6], 10) || memTotal - memUsed;
  }

  let swapTotal = 0,
    swapUsed = 0;
  if (swapLine) {
    const parts = swapLine.split(/\s+/);
    swapTotal = parseInt(parts[1], 10) || 0;
    swapUsed = parseInt(parts[2], 10) || 0;
  }

  const dfLines = dfOut
    .trim()
    .split("\n")
    .slice(1)
    .filter((l) => !l.includes("tmpfs") && !l.includes("devtmpfs") && !l.includes("overlay"));

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

export async function handleCpu(manager: SshManager, host: string): Promise<string> {
  const hostConfig = manager.findHost(host);
  const hasMpstat = await hasCommand(manager, host, "mpstat");

  const [lscpuOut, cpuData] = await Promise.all([
    manager.exec(
      host,
      'lscpu | grep -E "^(Architecture|Model name|CPU\\(s\\)|Thread|Core|Socket)"'
    ),
    hasMpstat
      ? manager.exec(host, "mpstat -P ALL 1 1")
      : manager.exec(host, "top -bn1 | head -5"),
  ]);

  let result = `=== CPU 详情: ${hostConfig?.name || host} ===\n\n`;

  lscpuOut
    .trim()
    .split("\n")
    .forEach((line) => {
      const [key, ...vals] = line.split(":");
      if (key && vals.length > 0) {
        result += `${key.trim()}: ${vals.join(":").trim()}\n`;
      }
    });
  result += `\n`;

  if (hasMpstat) {
    result += `每核使用率 (采样 1 秒):\n`;
    const lines = cpuData.trim().split("\n");
    const cpuLines = lines.filter((l) => {
      const t = l.trim();
      return t.match(/^(all|\d+)\s/) || t.match(/^Average.*?(all|\d+)/);
    });

    const headers = ["CPU", "%usr", "%sys", "%iowait", "%idle"];
    const rows: string[][] = [];

    cpuLines.forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 12) {
        const cpu = parts.find((p) => p === "all" || /^\d+$/.test(p)) || "";
        rows.push([
          cpu === "all" ? "ALL" : `  ${cpu}`,
          parts[3] || "0",
          parts[5] || "0",
          parts[6] || "0",
          parts[parts.length - 1] || "0",
        ]);
      }
    });

    if (rows.length > 0) {
      result += formatTable(headers, rows);
    }
  } else {
    result += `(mpstat 未安装，使用 top 输出)\n\n`;
    result += cpuData.trim();
  }

  return result;
}

// ─── memory ──────────────────────────────────────────────

export async function handleMemory(manager: SshManager, host: string): Promise<string> {
  const hostConfig = manager.findHost(host);

  const meminfoOut = await manager.exec(
    host,
    'cat /proc/meminfo | grep -E "(MemTotal|MemFree|MemAvailable|Buffers|^Cached|SwapTotal|SwapFree|Shmem)"'
  );

  let result = `=== 内存详情: ${hostConfig?.name || host} ===\n\n`;

  const memInfo: Record<string, number> = {};
  meminfoOut
    .trim()
    .split("\n")
    .forEach((line) => {
      const match = line.match(/^(\w+):\s+(\d+)\s+kB/);
      if (match) {
        memInfo[match[1]] = parseInt(match[2], 10) * 1024;
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

export async function handleDisk(manager: SshManager, host: string): Promise<string> {
  const hostConfig = manager.findHost(host);
  const hasIostat = await hasCommand(manager, host, "iostat");

  const [dfOut, dfInodeOut, ioOut] = await Promise.all([
    manager.exec(host, "df -h"),
    manager.exec(host, "df -i"),
    hasIostat ? manager.exec(host, "iostat -x 1 1") : Promise.resolve(""),
  ]);

  let result = `=== 磁盘详情: ${hostConfig?.name || host} ===\n\n`;

  const inodeLines = dfInodeOut.trim().split("\n");
  const inodeMap: Record<string, string> = {};
  inodeLines.slice(1).forEach((line) => {
    const parts = line.split(/\s+/);
    if (parts.length >= 6) {
      inodeMap[parts[5]] = parts[4];
    }
  });

  const headers = ["文件系统", "大小", "已用", "可用", "使用率", "inode", "挂载点"];
  const rows: string[][] = [];

  dfOut
    .trim()
    .split("\n")
    .slice(1)
    .forEach((line) => {
      const parts = line.split(/\s+/);
      if (parts.length >= 6 && !line.includes("tmpfs") && !line.includes("devtmpfs")) {
        const mount = parts[5];
        rows.push([parts[0], parts[1], parts[2], parts[3], parts[4], inodeMap[mount] || "-", mount]);
      }
    });

  result += formatTable(headers, rows);

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
    result += `\n\n(iostat 未安装，跳过 IO 统计。安装: yum install sysstat)\n`;
  }

  return result;
}

// ─── network ─────────────────────────────────────────────

export async function handleNetwork(manager: SshManager, host: string): Promise<string> {
  const hostConfig = manager.findHost(host);
  const hasSs = await hasCommand(manager, host, "ss");

  const [connOut, devOut, ipOut] = await Promise.all([
    hasSs
      ? manager.exec(host, "ss -s")
      : manager.exec(host, "netstat -s 2>/dev/null | head -20"),
    manager.exec(host, "cat /proc/net/dev"),
    manager.exec(
      host,
      "ip -brief addr 2>/dev/null || ifconfig 2>/dev/null | grep -E '(^\\w|inet )'"
    ),
  ]);

  let result = `=== 网络详情: ${hostConfig?.name || host} ===\n\n`;

  result += `连接统计:\n`;
  result += connOut
    .trim()
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
  result += `\n\n`;

  const devLines = devOut.trim().split("\n").slice(2);
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
  result += ipOut
    .trim()
    .split("\n")
    .map((l) => `  ${l.trim()}`)
    .join("\n");

  return result;
}

// ─── load ────────────────────────────────────────────────

export async function handleLoad(manager: SshManager, host: string): Promise<string> {
  const hostConfig = manager.findHost(host);
  const hasSar = await hasCommand(manager, host, "sar");

  const [uptimeOut, nprocOut, sarOut] = await Promise.all([
    manager.exec(host, "uptime"),
    manager.exec(host, "nproc"),
    hasSar ? manager.exec(host, "sar -q 1 3") : Promise.resolve(""),
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
    result += `\n(sar 未安装，无法展示趋势。安装: yum install sysstat)\n`;
  }

  return result;
}

// ─── process ─────────────────────────────────────────────

export async function handleProcess(
  manager: SshManager,
  host: string,
  sortBy: "cpu" | "memory",
  topN: number
): Promise<string> {
  const hostConfig = manager.findHost(host);
  const sortFlag = sortBy === "memory" ? "-%mem" : "-%cpu";
  const sortLabel = sortBy === "memory" ? "内存" : "CPU";

  const [psOut, zombieOut, totalOut] = await Promise.all([
    manager.exec(host, `ps aux --sort=${sortFlag} | head -${topN + 1}`),
    manager.exec(host, "ps aux | awk '{if($8==\"Z\") count++} END {print count+0}'"),
    manager.exec(host, "ps aux --no-headers | wc -l"),
  ]);

  let result = `=== 进程 Top ${topN} (按${sortLabel}): ${hostConfig?.name || host} ===\n\n`;

  const lines = psOut.trim().split("\n");
  if (lines.length > 1) {
    const headers = ["PID", "USER", "%CPU", "%MEM", "RSS", "COMMAND"];
    const rows: string[][] = [];

    lines.slice(1).forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 11) {
        const user = parts[0];
        const pid = parts[1];
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
