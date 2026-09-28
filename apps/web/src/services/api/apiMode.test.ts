import { describe, expect, it } from "vitest";
import {
  assertValidApiMode,
  invalidApiModeMessage,
  isValidApiMode,
  VALID_API_MODES,
} from "./apiMode";

describe("apiMode", () => {
  it("lists exactly http and mock as valid", () => {
    expect(VALID_API_MODES).toEqual(["http", "mock"]);
  });

  it.each([undefined, "", "http", "mock"])("accepts %p", (value) => {
    expect(isValidApiMode(value)).toBe(true);
    expect(() => assertValidApiMode(value)).not.toThrow();
  });

  it.each(["bogus", "HTTP", "Mock", "http ", " mock", "httpmock"])("rejects %p", (value) => {
    expect(isValidApiMode(value)).toBe(false);
    expect(() => assertValidApiMode(value)).toThrow();
  });

  it("is case-sensitive", () => {
    expect(isValidApiMode("HTTP")).toBe(false);
  });

  it("names the variable and both allowed values in the error message", () => {
    const message = invalidApiModeMessage("bogus");
    expect(message).toContain("VITE_API_MODE");
    expect(message).toContain('"bogus"');
    expect(message).toContain('"http"');
    expect(message).toContain('"mock"');
  });

  it("assertValidApiMode throws exactly invalidApiModeMessage's text", () => {
    expect(() => assertValidApiMode("bogus")).toThrow(invalidApiModeMessage("bogus"));
  });
});
