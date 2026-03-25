import { describe, it, expect } from "vitest";
import { wrapK8sError } from "./errors.js";

describe("wrapK8sError", () => {
  it("extracts K8s API error message", () => {
    const error = { response: { body: { message: "pods \"foo\" not found" } } };
    const result = wrapK8sError(error, "get pod");
    expect(result).toContain("get pod");
    expect(result).toContain("pods \"foo\" not found");
  });

  it("handles standard Error objects", () => {
    const error = new Error("connection refused");
    const result = wrapK8sError(error, "list pods");
    expect(result).toContain("list pods");
    expect(result).toContain("connection refused");
  });

  it("handles unknown error types", () => {
    const result = wrapK8sError("something broke", "describe node");
    expect(result).toContain("describe node");
    expect(result).toContain("Unknown error");
  });
});
