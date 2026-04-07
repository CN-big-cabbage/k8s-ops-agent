import { Client } from "ssh2";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { HostConfig } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

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

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}
