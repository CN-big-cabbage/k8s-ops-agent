import { describe, it, expect, vi, afterEach } from "vitest";
import { parseRelativeTime, K8sLogsSchema } from "./logs.js";

describe("parseRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00Z"));

    expect(parseRelativeTime("30s").getTime()).toBe(new Date("2026-03-25T11:59:30Z").getTime());
  });

  it("parses minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00Z"));

    expect(parseRelativeTime("5m").getTime()).toBe(new Date("2026-03-25T11:55:00Z").getTime());
  });

  it("parses hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00Z"));

    expect(parseRelativeTime("2h").getTime()).toBe(new Date("2026-03-25T10:00:00Z").getTime());
  });

  it("parses days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00Z"));

    expect(parseRelativeTime("1d").getTime()).toBe(new Date("2026-03-24T12:00:00Z").getTime());
  });

  it("parses ISO 8601", () => {
    const result = parseRelativeTime("2026-03-24T10:00:00Z");
    expect(result.toISOString()).toBe("2026-03-24T10:00:00.000Z");
  });

  it("throws on invalid format", () => {
    expect(() => parseRelativeTime("abc")).toThrow("Invalid time format");
  });
});

describe("K8sLogsSchema validation", () => {
  it("rejects invalid action", () => {
    const result = K8sLogsSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("defaults tail_lines to 100", () => {
    const result = K8sLogsSchema.parse({ action: "search" });
    expect(result.tail_lines).toBe(100);
  });

  it("accepts compare_pods tuple", () => {
    const result = K8sLogsSchema.parse({
      action: "compare",
      compare_pods: ["pod-1", "pod-2"],
    });
    expect(result.compare_pods).toEqual(["pod-1", "pod-2"]);
  });

  it("defaults namespace to 'default'", () => {
    const result = K8sLogsSchema.parse({ action: "search" });
    expect(result.namespace).toBe("default");
  });
});
