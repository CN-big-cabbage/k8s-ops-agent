import { describe, it, expect, vi, afterEach } from "vitest";
import { formatAge, formatTable, statusSymbol } from "./format.js";

describe("formatAge", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T12:00:30Z"));
    expect(formatAge(new Date("2026-03-24T12:00:00Z"))).toBe("30s");
  });

  it("formats minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T12:05:00Z"));
    expect(formatAge(new Date("2026-03-24T12:00:00Z"))).toBe("5m");
  });

  it("formats hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-24T15:00:00Z"));
    expect(formatAge(new Date("2026-03-24T12:00:00Z"))).toBe("3h");
  });

  it("formats days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T12:00:00Z"));
    expect(formatAge(new Date("2026-03-24T12:00:00Z"))).toBe("3d");
  });
});

describe("formatTable", () => {
  it("formats a simple table", () => {
    const result = formatTable(["NAME", "AGE"], [["nginx", "3d"], ["redis", "1h"]]);
    expect(result).toContain("NAME");
    expect(result).toContain("nginx");
    expect(result).toContain("redis");
    expect(result.split("\n")).toHaveLength(4); // header + separator + 2 rows
  });

  it("handles empty rows", () => {
    const result = formatTable(["NAME"], []);
    expect(result.split("\n")).toHaveLength(2); // header + separator
  });
});

describe("statusSymbol", () => {
  it("returns checkmark for success states", () => {
    expect(statusSymbol("Running")).toBe("✓");
    expect(statusSymbol("Ready")).toBe("✓");
    expect(statusSymbol("True")).toBe("✓");
  });

  it("returns X for failure states", () => {
    expect(statusSymbol("Failed")).toBe("✗");
    expect(statusSymbol("False")).toBe("✗");
    expect(statusSymbol("Error")).toBe("✗");
  });

  it("returns spinner for pending states", () => {
    expect(statusSymbol("Pending")).toBe("⟳");
    expect(statusSymbol("Unknown")).toBe("⟳");
  });
});
