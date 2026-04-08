import { describe, it, expect } from "vitest";
import { buildCli } from "./cli.js";

describe("CLI", () => {
  it("should create commands for all skill categories", () => {
    const program = buildCli({});
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain("pod");
    expect(commandNames).toContain("deploy");
    expect(commandNames).toContain("health");
    expect(commandNames).toContain("troubleshoot");
    expect(commandNames).toContain("sys-monitor");
  });

  it("should have 32 commands total", () => {
    const program = buildCli({});
    expect(program.commands.length).toBe(32);
  });

  it("should convert skill names to CLI command names correctly", () => {
    const program = buildCli({});
    const commandNames = program.commands.map((c) => c.name());

    expect(commandNames).toContain("event-analysis");
    expect(commandNames).toContain("netpol");
    expect(commandNames).toContain("statefulset");
    expect(commandNames).not.toContain("k8s_pod");
  });
});
