import { describe, it, expect } from "vitest";
import { getEventTimestamp, filterEvents, formatEventRow } from "./events.js";

// --- getEventTimestamp ---

describe("getEventTimestamp", () => {
  it("prefers lastTimestamp when available", () => {
    const event = {
      lastTimestamp: new Date("2026-03-25T10:00:00Z"),
      eventTime: new Date("2026-03-25T09:00:00Z"),
      metadata: { creationTimestamp: new Date("2026-03-25T08:00:00Z") },
    };
    expect(getEventTimestamp(event as any).toISOString()).toBe("2026-03-25T10:00:00.000Z");
  });

  it("falls back to eventTime when lastTimestamp is null", () => {
    const event = {
      lastTimestamp: null,
      eventTime: new Date("2026-03-25T09:00:00Z"),
      metadata: { creationTimestamp: new Date("2026-03-25T08:00:00Z") },
    };
    expect(getEventTimestamp(event as any).toISOString()).toBe("2026-03-25T09:00:00.000Z");
  });

  it("falls back to creationTimestamp when both are null", () => {
    const event = {
      lastTimestamp: null,
      eventTime: null,
      metadata: { creationTimestamp: new Date("2026-03-25T08:00:00Z") },
    };
    expect(getEventTimestamp(event as any).toISOString()).toBe("2026-03-25T08:00:00.000Z");
  });
});

// --- filterEvents ---

describe("filterEvents", () => {
  const events = [
    { type: "Warning", reason: "BackOff", involvedObject: { kind: "Pod", name: "api-1" }, message: "Back-off" },
    { type: "Normal", reason: "Scheduled", involvedObject: { kind: "Pod", name: "api-1" }, message: "Assigned" },
    { type: "Warning", reason: "FailedScheduling", involvedObject: { kind: "Pod", name: "worker-1" }, message: "No nodes" },
    { type: "Normal", reason: "Pulled", involvedObject: { kind: "Pod", name: "nginx-1" }, message: "Pulled image" },
    { type: "Warning", reason: "FailedMount", involvedObject: { kind: "Deployment", name: "api-deploy" }, message: "Mount failed" },
  ] as any[];

  it("filters by event_type", () => {
    const result = filterEvents(events, { event_type: "Warning" });
    expect(result).toHaveLength(3);
    expect(result.every((e: any) => e.type === "Warning")).toBe(true);
  });

  it("filters by reason", () => {
    const result = filterEvents(events, { reason: "BackOff" });
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("BackOff");
  });

  it("filters by resource_kind", () => {
    const result = filterEvents(events, { resource_kind: "Deployment" });
    expect(result).toHaveLength(1);
    expect(result[0].involvedObject.kind).toBe("Deployment");
  });

  it("filters by resource_name", () => {
    const result = filterEvents(events, { resource_name: "api-1" });
    expect(result).toHaveLength(2);
  });

  it("combines multiple filters with AND", () => {
    const result = filterEvents(events, { event_type: "Warning", resource_kind: "Pod" });
    expect(result).toHaveLength(2);
  });

  it("returns all events when no criteria", () => {
    const result = filterEvents(events, {});
    expect(result).toHaveLength(5);
  });
});

// --- formatEventRow ---

describe("formatEventRow", () => {
  it("formats event as table row array", () => {
    const event = {
      type: "Warning",
      reason: "BackOff",
      involvedObject: { kind: "Pod", name: "api-1" },
      message: "Back-off restarting failed container",
      lastTimestamp: new Date("2026-03-25T10:00:00Z"),
      eventTime: null,
      metadata: { creationTimestamp: new Date("2026-03-25T10:00:00Z") },
    };
    const row = formatEventRow(event as any);
    expect(row).toHaveLength(5); // [time, type, reason, object, message]
    expect(row[1]).toBe("Warning");
    expect(row[2]).toBe("BackOff");
    expect(row[3]).toBe("Pod/api-1");
  });
});

// --- Schema validation ---

describe("k8s-events schema validation", () => {
  it("rejects invalid action", async () => {
    const { z } = await import("zod");
    const schema = z.object({ action: z.enum(["list", "filter", "recent", "export"]) });
    const result = schema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("defaults namespace to default", async () => {
    const { z } = await import("zod");
    const schema = z.object({
      action: z.enum(["list", "filter", "recent", "export"]),
      namespace: z.string().default("default"),
    });
    const result = schema.parse({ action: "list" });
    expect(result.namespace).toBe("default");
  });

  it("defaults format to table", async () => {
    const { z } = await import("zod");
    const schema = z.object({
      action: z.enum(["list", "filter", "recent", "export"]),
      format: z.enum(["json", "table"]).default("table"),
    });
    const result = schema.parse({ action: "export" });
    expect(result.format).toBe("table");
  });

  it("defaults limit to 50", async () => {
    const { z } = await import("zod");
    const schema = z.object({
      action: z.enum(["list", "filter", "recent", "export"]),
      limit: z.number().int().positive().default(50),
    });
    const result = schema.parse({ action: "list" });
    expect(result.limit).toBe(50);
  });
});
