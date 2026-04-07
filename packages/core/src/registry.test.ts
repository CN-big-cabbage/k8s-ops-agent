import { describe, it, expect } from "vitest";
import { skillRegistry } from "./registry.js";

describe("skillRegistry", () => {
  it("should contain 32 skills", () => {
    expect(skillRegistry.length).toBe(32);
  });

  it("should have unique names", () => {
    const names = skillRegistry.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("should have required fields on every skill", () => {
    for (const skill of skillRegistry) {
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.schema).toBeTruthy();
      expect(typeof skill.handler).toBe("function");
    }
  });

  it("should have names starting with k8s_ or sys_", () => {
    for (const skill of skillRegistry) {
      expect(skill.name).toMatch(/^(k8s_|sys_)/);
    }
  });
});
