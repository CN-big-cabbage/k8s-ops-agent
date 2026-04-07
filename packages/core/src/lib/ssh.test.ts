import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SshManager } from "./ssh.js";
import type { HostConfig } from "./types.js";

const testHosts: HostConfig[] = [
  { name: "master-1", host: "172.16.190.101", username: "root", privateKeyPath: "~/.ssh/id_rsa" },
  { name: "worker-1", host: "172.16.190.111", port: 2222, username: "ops", password: "test123" },
];

// Mock ssh2 Client
vi.mock("ssh2", () => {
  class MockClient {
    private handlers: Record<string, Function> = {};

    on(event: string, cb: Function) {
      this.handlers[event] = cb;
      if (event === "ready") setTimeout(() => cb(), 5);
      return this;
    }

    exec(_cmd: string, cb: Function) {
      const stream = {
        on(event: string, handler: Function) {
          if (event === "data") setTimeout(() => handler(Buffer.from("mock output")), 3);
          if (event === "close") setTimeout(() => handler(0, undefined), 8);
          return this;
        },
        stderr: {
          on(_event: string, _handler: Function) {
            return this;
          },
        },
      };
      cb(null, stream);
    }

    end() {}
    destroy() {}
    connect() {}
  }

  return { Client: MockClient };
});

// Mock fs.readFileSync for private key
vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from("mock-private-key")),
}));

describe("SshManager", () => {
  let manager: SshManager;

  beforeEach(() => {
    manager = new SshManager(testHosts);
  });

  afterEach(() => {
    manager.closeAll();
  });

  describe("listHosts", () => {
    it("returns all configured hosts", () => {
      const hosts = manager.listHosts();
      expect(hosts).toHaveLength(2);
      expect(hosts[0].name).toBe("master-1");
      expect(hosts[1].name).toBe("worker-1");
    });

    it("returns empty array when no hosts configured", () => {
      const emptyManager = new SshManager([]);
      expect(emptyManager.listHosts()).toHaveLength(0);
      emptyManager.closeAll();
    });
  });

  describe("findHost", () => {
    it("resolves by name", () => {
      const host = manager.findHost("master-1");
      expect(host).toBeDefined();
      expect(host!.host).toBe("172.16.190.101");
    });

    it("resolves by IP", () => {
      const host = manager.findHost("172.16.190.111");
      expect(host).toBeDefined();
      expect(host!.name).toBe("worker-1");
    });

    it("returns undefined for unknown host", () => {
      expect(manager.findHost("unknown")).toBeUndefined();
    });
  });

  describe("exec", () => {
    it("runs command and returns output", async () => {
      const result = await manager.exec("master-1", "uptime");
      expect(result).toBe("mock output");
    });

    it("throws for unknown host", async () => {
      await expect(manager.exec("nonexistent", "uptime"))
        .rejects.toThrow("未找到主机");
    });

    it("includes available hosts in error message", async () => {
      await expect(manager.exec("nonexistent", "uptime"))
        .rejects.toThrow("master-1");
    });
  });
});
