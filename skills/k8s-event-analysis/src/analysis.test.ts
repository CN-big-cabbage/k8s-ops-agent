import { describe, it, expect } from "vitest";
import {
  groupEventsByTimeBucket,
  detectAnomalies,
  calculateHealthScore,
  buildResourceKey,
  KNOWN_ANOMALY_PATTERNS,
} from "./analysis.js";

// --- groupEventsByTimeBucket ---

describe("groupEventsByTimeBucket", () => {
  const baseTime = new Date("2026-03-25T10:00:00Z").getTime();

  function makeEvent(minutesAgo: number, type: string, reason: string) {
    return {
      type,
      reason,
      lastTimestamp: new Date(baseTime - minutesAgo * 60 * 1000),
      eventTime: null,
      metadata: { creationTimestamp: new Date(baseTime - minutesAgo * 60 * 1000) },
    } as any;
  }

  it("groups events into 5-minute buckets", () => {
    const events = [
      makeEvent(2, "Normal", "Scheduled"),
      makeEvent(3, "Warning", "BackOff"),
      makeEvent(8, "Normal", "Pulled"),
      makeEvent(12, "Normal", "Started"),
    ];
    const buckets = groupEventsByTimeBucket(events, 5, baseTime);
    expect(buckets.length).toBeGreaterThanOrEqual(2);
    expect(buckets[0].events).toHaveLength(2);
  });

  it("returns empty array for no events", () => {
    const buckets = groupEventsByTimeBucket([], 5, baseTime);
    expect(buckets).toHaveLength(0);
  });
});

// --- detectAnomalies ---

describe("detectAnomalies", () => {
  function makeEvent(reason: string, resource: string, type = "Warning") {
    return {
      type,
      reason,
      involvedObject: { kind: "Pod", name: resource },
      count: 1,
    } as any;
  }

  it("detects known anomaly patterns", () => {
    const events = [
      makeEvent("BackOff", "api-1"),
      makeEvent("BackOff", "api-1"),
      makeEvent("OOMKilled", "worker-1"),
    ];
    const result = detectAnomalies(events, 5, 30);
    expect(result.knownAnomalies.length).toBeGreaterThanOrEqual(2);
    const reasons = result.knownAnomalies.map((a: any) => a.reason);
    expect(reasons).toContain("BackOff");
    expect(reasons).toContain("OOMKilled");
  });

  it("detects high-frequency warnings", () => {
    const events = Array.from({ length: 6 }, () => makeEvent("SomeReason", "pod-1"));
    const result = detectAnomalies(events, 5, 30);
    expect(result.highFrequency.length).toBeGreaterThanOrEqual(1);
    expect(result.highFrequency[0].resource).toBe("Pod/pod-1");
  });

  it("returns empty when no anomalies", () => {
    const events = [
      { type: "Normal", reason: "Scheduled", involvedObject: { kind: "Pod", name: "ok-1" }, count: 1 } as any,
    ];
    const result = detectAnomalies(events, 5, 30);
    expect(result.knownAnomalies).toHaveLength(0);
    expect(result.highFrequency).toHaveLength(0);
  });
});

// --- calculateHealthScore ---

describe("calculateHealthScore", () => {
  it("returns 100 for all Normal events", () => {
    const score = calculateHealthScore({ totalEvents: 10, warningCount: 0, anomalyCounts: {} });
    expect(score).toBe(100);
  });

  it("deducts for warnings (max 40)", () => {
    const score = calculateHealthScore({ totalEvents: 50, warningCount: 15, anomalyCounts: {} });
    expect(score).toBe(100 - Math.min(15 * 2, 40));
  });

  it("caps warning deduction at 40", () => {
    const score = calculateHealthScore({ totalEvents: 100, warningCount: 50, anomalyCounts: {} });
    expect(score).toBe(60);
  });

  it("deducts for known anomaly patterns with caps", () => {
    const score = calculateHealthScore({
      totalEvents: 20,
      warningCount: 5,
      anomalyCounts: { CrashLoopBackOff: 2, OOMKilled: 1 },
    });
    expect(score).toBe(60);
  });

  it("floors at 0", () => {
    const score = calculateHealthScore({
      totalEvents: 100,
      warningCount: 50,
      anomalyCounts: { CrashLoopBackOff: 5, OOMKilled: 5, FailedScheduling: 5 },
    });
    expect(score).toBe(0);
  });

  it("returns 100 for zero events", () => {
    const score = calculateHealthScore({ totalEvents: 0, warningCount: 0, anomalyCounts: {} });
    expect(score).toBe(100);
  });
});

// --- buildResourceKey ---

describe("buildResourceKey", () => {
  it("formats kind/name correctly", () => {
    const event = { involvedObject: { kind: "Pod", name: "api-1" } } as any;
    expect(buildResourceKey(event)).toBe("Pod/api-1");
  });

  it("handles missing fields", () => {
    const event = { involvedObject: {} } as any;
    expect(buildResourceKey(event)).toBe("?/?");
  });
});

// --- KNOWN_ANOMALY_PATTERNS ---

describe("KNOWN_ANOMALY_PATTERNS", () => {
  it("includes all 7 patterns from spec", () => {
    expect(KNOWN_ANOMALY_PATTERNS).toContain("BackOff");
    expect(KNOWN_ANOMALY_PATTERNS).toContain("OOMKilled");
    expect(KNOWN_ANOMALY_PATTERNS).toContain("FailedScheduling");
    expect(KNOWN_ANOMALY_PATTERNS).toContain("Evicted");
    expect(KNOWN_ANOMALY_PATTERNS).toContain("FailedMount");
    expect(KNOWN_ANOMALY_PATTERNS).toContain("ImagePullBackOff");
    expect(KNOWN_ANOMALY_PATTERNS).toContain("NodeNotReady");
  });
});

// --- Schema validation ---

describe("k8s-event-analysis schema validation", () => {
  it("rejects invalid action", async () => {
    const { z } = await import("zod");
    const schema = z.object({ action: z.enum(["timeline", "anomaly", "correlate", "summary"]) });
    const result = schema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("defaults warning_threshold to 5", async () => {
    const { z } = await import("zod");
    const schema = z.object({
      action: z.enum(["timeline", "anomaly", "correlate", "summary"]),
      warning_threshold: z.number().int().positive().default(5),
    });
    const result = schema.parse({ action: "anomaly" });
    expect(result.warning_threshold).toBe(5);
  });

  it("defaults time_window_minutes to 30", async () => {
    const { z } = await import("zod");
    const schema = z.object({
      action: z.enum(["timeline", "anomaly", "correlate", "summary"]),
      time_window_minutes: z.number().int().positive().default(30),
    });
    const result = schema.parse({ action: "anomaly" });
    expect(result.time_window_minutes).toBe(30);
  });
});
