import { afterEach, describe, expect, it, vi } from "vitest";
import { createRootBoundaryErrorRecord, reportRootBoundaryError } from "@/lib/root-error-reporting";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRootBoundaryErrorRecord", () => {
  it("summarizes an Error as kind 'error', without leaking its message", () => {
    const record = createRootBoundaryErrorRecord(new Error("sensitive detail"));

    expect(record.error).toEqual({ kind: "error" });
    expect(JSON.stringify(record)).not.toContain("sensitive detail");
  });

  it("summarizes a Response as kind 'response' with its status", () => {
    const record = createRootBoundaryErrorRecord(new Response(null, { status: 503 }));

    expect(record.error).toEqual({ kind: "response", status: 503 });
  });

  it("summarizes any other thrown value as kind 'unknown' with its typeof", () => {
    expect(createRootBoundaryErrorRecord("a thrown string").error).toEqual({
      kind: "unknown",
      valueType: "string",
    });
    expect(createRootBoundaryErrorRecord(null).error).toEqual({
      kind: "unknown",
      valueType: "null",
    });
    expect(createRootBoundaryErrorRecord(42).error).toEqual({
      kind: "unknown",
      valueType: "number",
    });
  });

  it("falls back to a safe 'unknown' summary when instanceof checks throw", () => {
    // A Proxy whose getPrototypeOf trap throws makes `error instanceof X`
    // itself throw, which is exactly the defensive case summarizeError's
    // try/catch exists for.
    const poison = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("no prototype for you");
        },
      },
    );

    expect(createRootBoundaryErrorRecord(poison).error).toEqual({
      kind: "unknown",
      valueType: "object",
    });
  });

  it("records the current path only when it's on the safe allowlist", () => {
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, pathname: "/tasks" },
    });

    expect(createRootBoundaryErrorRecord(new Error("x")).routePath).toBe("/tasks");

    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("records null for a path outside the safe allowlist", () => {
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, pathname: "/some/unlisted/path" },
    });

    expect(createRootBoundaryErrorRecord(new Error("x")).routePath).toBeNull();

    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("records null instead of throwing when reading window.location fails", () => {
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      get() {
        throw new Error("location unavailable");
      },
    });

    expect(createRootBoundaryErrorRecord(new Error("x")).routePath).toBeNull();

    Object.defineProperty(window, "location", { configurable: true, value: original });
  });
});

describe("reportRootBoundaryError", () => {
  it("logs the record through console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");

    reportRootBoundaryError(error);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      event: "planora.root_boundary_error",
      error: { kind: "error" },
    });
  });

  it("never throws even if the logging sink itself throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("sink is down");
    });

    expect(() => reportRootBoundaryError(new Error("boom"))).not.toThrow();
  });
});
