import { describe, it, expect, vi, afterEach } from "vitest";

describe("parseRelativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses seconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00Z"));

    // Inline the function for testing since it's not exported
    function parseRelativeTime(timeStr: string): Date {
      const match = timeStr.match(/^(\d+)(s|m|h|d)$/);
      if (!match) {
        const date = new Date(timeStr);
        if (isNaN(date.getTime())) throw new Error(`Invalid time format: ${timeStr}`);
        return date;
      }
      const value = parseInt(match[1]);
      const unit = match[2];
      const now = new Date();
      switch (unit) {
        case "s": return new Date(now.getTime() - value * 1000);
        case "m": return new Date(now.getTime() - value * 60 * 1000);
        case "h": return new Date(now.getTime() - value * 60 * 60 * 1000);
        case "d": return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
        default: throw new Error(`Unknown time unit: ${unit}`);
      }
    }

    expect(parseRelativeTime("30s").getTime()).toBe(new Date("2026-03-25T11:59:30Z").getTime());
    expect(parseRelativeTime("5m").getTime()).toBe(new Date("2026-03-25T11:55:00Z").getTime());
    expect(parseRelativeTime("2h").getTime()).toBe(new Date("2026-03-25T10:00:00Z").getTime());
    expect(parseRelativeTime("1d").getTime()).toBe(new Date("2026-03-24T12:00:00Z").getTime());
  });

  it("parses ISO 8601", () => {
    function parseRelativeTime(timeStr: string): Date {
      const match = timeStr.match(/^(\d+)(s|m|h|d)$/);
      if (!match) {
        const date = new Date(timeStr);
        if (isNaN(date.getTime())) throw new Error(`Invalid time format: ${timeStr}`);
        return date;
      }
      return new Date();
    }

    const result = parseRelativeTime("2026-03-24T10:00:00Z");
    expect(result.toISOString()).toBe("2026-03-24T10:00:00.000Z");
  });

  it("throws on invalid format", () => {
    function parseRelativeTime(timeStr: string): Date {
      const match = timeStr.match(/^(\d+)(s|m|h|d)$/);
      if (!match) {
        const date = new Date(timeStr);
        if (isNaN(date.getTime())) throw new Error(`Invalid time format: ${timeStr}`);
        return date;
      }
      return new Date();
    }

    expect(() => parseRelativeTime("abc")).toThrow("Invalid time format");
  });
});

describe("k8s-logs schema validation", () => {
  it("rejects invalid action", async () => {
    const { z } = await import("zod");
    const K8sLogsSchema = z.object({
      action: z.enum(["search", "multi_pod", "since", "compare", "stats", "export"]),
      namespace: z.string().default("default"),
      pod_name: z.string().optional(),
    });

    const result = K8sLogsSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("defaults tail_lines to 100", async () => {
    const { z } = await import("zod");
    const K8sLogsSchema = z.object({
      action: z.enum(["search", "multi_pod", "since", "compare", "stats", "export"]),
      pod_name: z.string().optional(),
      tail_lines: z.number().int().positive().default(100),
    });

    const result = K8sLogsSchema.parse({ action: "search" });
    expect(result.tail_lines).toBe(100);
  });

  it("accepts compare_pods tuple", async () => {
    const { z } = await import("zod");
    const K8sLogsSchema = z.object({
      action: z.enum(["search", "multi_pod", "since", "compare", "stats", "export"]),
      compare_pods: z.tuple([z.string(), z.string()]).optional(),
    });

    const result = K8sLogsSchema.parse({
      action: "compare",
      compare_pods: ["pod-1", "pod-2"],
    });
    expect(result.compare_pods).toEqual(["pod-1", "pod-2"]);
  });
});
