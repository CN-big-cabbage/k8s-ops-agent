import { describe, it, expect } from "vitest";
import { parseCpuValue, parseMemoryValue, formatCpu, formatMemory } from "./metrics.js";

describe("parseCpuValue", () => {
  it("parses nanocores", () => {
    expect(parseCpuValue("250000000n")).toBe(250);
  });

  it("parses microcores", () => {
    expect(parseCpuValue("500000u")).toBe(500);
  });

  it("parses millicores", () => {
    expect(parseCpuValue("250m")).toBe(250);
  });

  it("parses whole cores", () => {
    expect(parseCpuValue("2")).toBe(2000);
    expect(parseCpuValue("1.5")).toBe(1500);
  });
});

describe("parseMemoryValue", () => {
  it("parses Ki", () => {
    expect(parseMemoryValue("1024Ki")).toBe(1024 * 1024);
  });

  it("parses Mi", () => {
    expect(parseMemoryValue("256Mi")).toBe(256 * 1024 * 1024);
  });

  it("parses Gi", () => {
    expect(parseMemoryValue("2Gi")).toBe(2 * 1024 * 1024 * 1024);
  });

  it("parses raw bytes", () => {
    expect(parseMemoryValue("1048576")).toBe(1048576);
  });

  it("parses decimal units (M)", () => {
    expect(parseMemoryValue("500M")).toBe(500 * 1000 * 1000);
  });
});

describe("formatCpu", () => {
  it("formats millicores", () => {
    expect(formatCpu(250)).toBe("250m");
    expect(formatCpu(50)).toBe("50m");
  });

  it("formats cores when >= 1000m", () => {
    expect(formatCpu(1000)).toBe("1.0 cores");
    expect(formatCpu(2500)).toBe("2.5 cores");
  });
});

describe("formatMemory", () => {
  it("formats as Mi for small values", () => {
    expect(formatMemory(256 * 1024 * 1024)).toBe("256Mi");
  });

  it("formats as Gi for large values", () => {
    expect(formatMemory(2 * 1024 * 1024 * 1024)).toBe("2.0Gi");
  });
});

describe("k8s-metrics schema validation", () => {
  it("rejects invalid action", async () => {
    const { z } = await import("zod");
    const K8sMetricsSchema = z.object({
      action: z.enum(["pod_resources", "node_resources", "top_pods", "top_nodes", "namespace_usage", "capacity_report"]),
    });

    const result = K8sMetricsSchema.safeParse({ action: "invalid" });
    expect(result.success).toBe(false);
  });

  it("defaults sort_by to cpu", async () => {
    const { z } = await import("zod");
    const K8sMetricsSchema = z.object({
      action: z.enum(["pod_resources", "node_resources", "top_pods", "top_nodes", "namespace_usage", "capacity_report"]),
      sort_by: z.enum(["cpu", "memory"]).default("cpu"),
    });

    const result = K8sMetricsSchema.parse({ action: "top_pods" });
    expect(result.sort_by).toBe("cpu");
  });

  it("defaults top_n to 10", async () => {
    const { z } = await import("zod");
    const K8sMetricsSchema = z.object({
      action: z.enum(["pod_resources", "node_resources", "top_pods", "top_nodes", "namespace_usage", "capacity_report"]),
      top_n: z.number().int().positive().default(10),
    });

    const result = K8sMetricsSchema.parse({ action: "top_nodes" });
    expect(result.top_n).toBe(10);
  });

  it("defaults namespace to default", async () => {
    const { z } = await import("zod");
    const K8sMetricsSchema = z.object({
      action: z.enum(["pod_resources", "node_resources", "top_pods", "top_nodes", "namespace_usage", "capacity_report"]),
      namespace: z.string().default("default"),
    });

    const result = K8sMetricsSchema.parse({ action: "capacity_report" });
    expect(result.namespace).toBe("default");
  });
});
