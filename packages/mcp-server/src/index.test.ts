import { describe, it, expect } from "vitest";
import { skillRegistry } from "@k8s-ops/core";

describe("MCP Server", () => {
  it("should have access to all 32 skills from core", () => {
    expect(skillRegistry.length).toBe(32);
  });

  it("every skill name is a valid MCP tool name (no spaces, lowercase)", () => {
    for (const skill of skillRegistry) {
      expect(skill.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
