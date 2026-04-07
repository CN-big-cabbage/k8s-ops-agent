import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock ssh module before importing monitor
const mockExec = vi.fn();
const mockFindHost = vi.fn();
const mockListHosts = vi.fn();
const mockCloseAll = vi.fn();

vi.mock("../lib/ssh.js", () => {
  class MockSshManager {
    constructor() {}
    exec = mockExec;
    findHost = mockFindHost;
    listHosts = mockListHosts;
    closeAll = mockCloseAll;
  }
  return { SshManager: MockSshManager };
});

import { SysMonitorSchema, handleSysMonitor, resetManager } from "./sys-monitor.js";

const testConfig = {
  hosts: [{ name: "master-1", host: "172.16.190.101", username: "root" }],
};

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

  it("accepts process with sort_by=memory", () => {
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

  it("rejects top_n > 50", () => {
    const result = SysMonitorSchema.safeParse({
      action: "process",
      host: "master-1",
      top_n: 100,
    });
    expect(result.success).toBe(false);
  });

  it("rejects top_n < 1", () => {
    const result = SysMonitorSchema.safeParse({
      action: "process",
      host: "master-1",
      top_n: 0,
    });
    expect(result.success).toBe(false);
  });

  it("defaults sort_by to cpu", () => {
    const result = SysMonitorSchema.parse({ action: "process", host: "master-1" });
    expect(result.sort_by).toBe("cpu");
  });

  it("defaults top_n to 15", () => {
    const result = SysMonitorSchema.parse({ action: "process", host: "master-1" });
    expect(result.top_n).toBe(15);
  });
});

describe("handleSysMonitor", () => {
  beforeEach(() => {
    mockExec.mockReset();
    mockFindHost.mockReset();
    mockFindHost.mockReturnValue({ name: "master-1", host: "172.16.190.101", username: "root" });
    resetManager();
  });

  afterEach(() => {
    resetManager();
  });

  describe("overview", () => {
    it("returns formatted overview", async () => {
      mockExec.mockImplementation(async (_host: string, cmd: string) => {
        if (cmd === "hostname") return "k8s-master-01\n";
        if (cmd === "uptime")
          return " 14:30:01 up 45 days,  3:22,  2 users,  load average: 1.23, 0.98, 0.87\n";
        if (cmd === "nproc") return "8\n";
        if (cmd === "free -b") {
          return [
            "              total        used        free      shared  buff/cache   available",
            "Mem:    34359738368 19864223744  2254857728   536870912 12240656896 14495514624",
            "Swap:    4294967296   209715200  4085252096",
          ].join("\n");
        }
        if (cmd.includes("df")) {
          return [
            "Filesystem      Size  Used Avail Use% Mounted on",
            "/dev/sda1        50G   35G   15G  70% /",
            "/dev/sdb1       200G  120G   80G  60% /data",
          ].join("\n");
        }
        return "";
      });

      const result = await handleSysMonitor({ action: "overview", host: "master-1" }, testConfig);

      expect(result).toContain("master-1");
      expect(result).toContain("k8s-master-01");
      expect(result).toContain("1.23");
      expect(result).toContain("45 days");
      expect(result).toContain("8");
      expect(result).toContain("/dev/sda1");
    });
  });

  describe("cpu", () => {
    it("returns CPU info with mpstat", async () => {
      mockExec.mockImplementation(async (_host: string, cmd: string) => {
        if (cmd.includes("which")) return "/usr/bin/mpstat\n";
        if (cmd.includes("lscpu")) {
          return [
            "Architecture:        x86_64",
            "CPU(s):              8",
            "Model name:          Intel Xeon E5-2680",
          ].join("\n");
        }
        if (cmd.includes("mpstat")) {
          return [
            "Linux 5.4.0",
            "",
            "14:30:01  CPU  %usr  %nice  %sys  %iowait  %irq  %soft  %steal  %guest  %gnice  %idle",
            "14:30:02  all  23.5   0.0    5.2    1.3     0.1    0.2     0.0     0.0     0.0    69.7",
            "14:30:02    0  45.2   0.0    8.1    0.5     0.2    0.3     0.0     0.0     0.0    45.7",
          ].join("\n");
        }
        return "";
      });

      const result = await handleSysMonitor({ action: "cpu", host: "master-1" }, testConfig);

      expect(result).toContain("CPU 详情");
      expect(result).toContain("x86_64");
      expect(result).toContain("Intel Xeon");
    });

    it("falls back to top when mpstat not available", async () => {
      mockExec.mockImplementation(async (_host: string, cmd: string) => {
        if (cmd.includes("which")) throw new Error("not found");
        if (cmd.includes("lscpu")) return "Architecture:        x86_64\n";
        if (cmd.includes("top")) return "top - 14:30:01 up 45 days, load average: 1.23\n";
        return "";
      });

      const result = await handleSysMonitor({ action: "cpu", host: "master-1" }, testConfig);

      expect(result).toContain("mpstat 未安装");
      expect(result).toContain("top");
    });
  });

  describe("memory", () => {
    it("returns formatted memory info", async () => {
      mockExec.mockImplementation(async (_host: string, cmd: string) => {
        if (cmd.includes("/proc/meminfo")) {
          return [
            "MemTotal:       33554432 kB",
            "MemFree:         2203648 kB",
            "MemAvailable:   14155776 kB",
            "Buffers:          524288 kB",
            "Cached:         11534336 kB",
            "SwapTotal:       4194304 kB",
            "SwapFree:        3989504 kB",
            "Shmem:            524288 kB",
          ].join("\n");
        }
        return "";
      });

      const result = await handleSysMonitor({ action: "memory", host: "master-1" }, testConfig);

      expect(result).toContain("内存详情");
      expect(result).toContain("物理内存");
      expect(result).toContain("Swap");
      expect(result).toContain("缓存");
    });
  });

  describe("disk", () => {
    it("returns disk usage and IO", async () => {
      mockExec.mockImplementation(async (_host: string, cmd: string) => {
        if (cmd.includes("which")) return "/usr/bin/iostat\n";
        if (cmd === "df -h") {
          return [
            "Filesystem      Size  Used Avail Use% Mounted on",
            "/dev/sda1        50G   35G   15G  70% /",
          ].join("\n");
        }
        if (cmd === "df -i") {
          return [
            "Filesystem      Inodes  IUsed   IFree IUse% Mounted on",
            "/dev/sda1      3276800 393216 2883584   12% /",
          ].join("\n");
        }
        if (cmd.includes("iostat")) {
          return [
            "Device  rrqm/s wrqm/s r/s w/s rMB/s wMB/s await %util",
            "sda     0.12   5.43  12.3 45.6 0.5  2.3   1.2   8.5",
          ].join("\n");
        }
        return "";
      });

      const result = await handleSysMonitor({ action: "disk", host: "master-1" }, testConfig);

      expect(result).toContain("磁盘详情");
      expect(result).toContain("/dev/sda1");
      expect(result).toContain("IO 统计");
    });
  });

  describe("network", () => {
    it("returns network stats", async () => {
      mockExec.mockImplementation(async (_host: string, cmd: string) => {
        if (cmd.includes("which")) return "/usr/sbin/ss\n";
        if (cmd.includes("ss -s")) return "Total: 280\nTCP:   236 (estab 180)\n";
        if (cmd.includes("/proc/net/dev")) {
          return [
            "Inter-|   Receive",
            " face |bytes    packets",
            "  eth0: 1234567890 12345678 0 0 0 0 0 0 9876543210 9876543 0 0 0 0 0 0",
          ].join("\n");
        }
        if (cmd.includes("ip -brief")) return "eth0  UP  172.16.190.101/24\n";
        return "";
      });

      const result = await handleSysMonitor({ action: "network", host: "master-1" }, testConfig);

      expect(result).toContain("网络详情");
      expect(result).toContain("连接统计");
      expect(result).toContain("eth0");
    });
  });

  describe("load", () => {
    it("returns load with assessment", async () => {
      mockExec.mockImplementation(async (_host: string, cmd: string) => {
        if (cmd.includes("which")) throw new Error("not found");
        if (cmd === "uptime")
          return " 14:30:01 up 45 days,  3:22,  2 users,  load average: 1.23, 0.98, 0.87\n";
        if (cmd === "nproc") return "8\n";
        return "";
      });

      const result = await handleSysMonitor({ action: "load", host: "master-1" }, testConfig);

      expect(result).toContain("系统负载");
      expect(result).toContain("1.23");
      expect(result).toContain("正常");
      expect(result).toContain("0.15");
    });

    it("shows warning for high load", async () => {
      mockExec.mockImplementation(async (_host: string, cmd: string) => {
        if (cmd.includes("which")) throw new Error("not found");
        if (cmd === "uptime")
          return " 14:30:01 up 1 day,  1:00,  1 users,  load average: 12.5, 10.2, 8.7\n";
        if (cmd === "nproc") return "8\n";
        return "";
      });

      const result = await handleSysMonitor({ action: "load", host: "master-1" }, testConfig);

      expect(result).toContain("过载");
    });
  });

  describe("process", () => {
    it("returns top processes by CPU", async () => {
      mockExec.mockImplementation(async (_host: string, cmd: string) => {
        if (cmd.includes("ps aux --sort")) {
          return [
            "USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND",
            "root      1234 45.2  3.1 500000 102400 ?       Ssl  Mar24 100:00 kube-apiserver",
            "root      2345 12.8  8.5 800000 280000 ?       Ssl  Mar24  50:00 etcd",
          ].join("\n");
        }
        if (cmd.includes("awk")) return "0\n";
        if (cmd.includes("wc")) return "312\n";
        return "";
      });

      const result = await handleSysMonitor(
        { action: "process", host: "master-1", sort_by: "cpu", top_n: 15 },
        testConfig
      );

      expect(result).toContain("进程 Top 15");
      expect(result).toContain("kube-apiserver");
      expect(result).toContain("etcd");
      expect(result).toContain("312 个进程");
    });

    it("shows zombie count when present", async () => {
      mockExec.mockImplementation(async (_host: string, cmd: string) => {
        if (cmd.includes("ps aux --sort")) return "USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\n";
        if (cmd.includes("awk")) return "3\n";
        if (cmd.includes("wc")) return "200\n";
        return "";
      });

      const result = await handleSysMonitor(
        { action: "process", host: "master-1", sort_by: "cpu", top_n: 15 },
        testConfig
      );

      expect(result).toContain("3 个僵尸进程");
    });
  });
});
