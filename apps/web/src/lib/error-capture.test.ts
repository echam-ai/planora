import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, consumeLastCapturedError } from "@/lib/error-capture";

afterEach(() => {
  // drain any capture a test left behind so the TTL/consume state starts
  // clean for the next test
  consumeLastCapturedError();
  vi.useRealTimers();
});

describe("describeError", () => {
  it("expands a single error into its message and stack, with no status suffix", () => {
    const err = new Error("boom");

    const text = describeError(err);

    expect(text).toContain("boom");
    expect(text).not.toContain("(status");
  });

  it("falls back to name/message when the error has no stack", () => {
    const err = new Error("no stack here");
    delete err.stack;

    expect(describeError(err)).toBe("Error: no stack here");
  });

  it("appends a numeric status when present", () => {
    const err = Object.assign(new Error("nope"), { status: 404 });

    expect(describeError(err)).toContain("(status 404)");
  });

  it("falls back to statusCode when status is absent", () => {
    const err = Object.assign(new Error("nope"), { statusCode: 500 });

    expect(describeError(err)).toContain("(status 500)");
  });

  it("walks the cause chain, labelling every entry after the first", () => {
    let err = new Error("root cause");
    for (let i = 0; i < 6; i++) {
      err = new Error(`layer ${i}`, { cause: err });
    }

    const text = describeError(err);

    // CAUSE_DEPTH_LIMIT = 5: five entries total, four labelled "caused by:"
    expect((text.match(/caused by:/g) ?? []).length).toBe(4);
  });

  it("stops at a non-Error cause and stringifies it as JSON", () => {
    const err = new Error("outer", { cause: { reason: "network" } });

    expect(describeError(err)).toContain('{"reason":"network"}');
  });

  it("stringifies a non-Error value passed directly, without a stack", () => {
    expect(describeError({ a: 1 })).toBe('{"a":1}');
  });

  it("stringifies a plain string value passed directly", () => {
    expect(describeError("just a string")).toBe("just a string");
  });

  it("falls back to String() when a non-Error value cannot be JSON-stringified", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    expect(describeError(circular)).toBe(String(circular));
  });

  it("falls back to String() when JSON.stringify returns undefined without throwing", () => {
    const fn = () => "unused";

    // JSON.stringify(fn) returns `undefined` (not a throw), which is the
    // other way safeStringify's `??` fallback is reached.
    expect(describeError(fn)).toBe(String(fn));
  });

  it("truncates to the description length limit", () => {
    const err = new Error("x".repeat(20_000));

    expect(describeError(err).length).toBeLessThanOrEqual(8_000);
  });
});

describe("console.error wrapping and capture", () => {
  it("records an Error logged through console.error, readable exactly once", () => {
    const err = new Error("captured");

    console.error(err);

    expect(consumeLastCapturedError()).toBe(err);
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("does not record a non-Error console.error argument", () => {
    console.error("just a string, not an error");

    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("expires a capture once its TTL has passed", () => {
    vi.useFakeTimers();
    const err = new Error("stale");

    console.error(err);
    vi.advanceTimersByTime(5_001);

    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("keeps a capture available before its TTL has passed", () => {
    vi.useFakeTimers();
    const err = new Error("still fresh");

    console.error(err);
    vi.advanceTimersByTime(4_999);

    expect(consumeLastCapturedError()).toBe(err);
  });
});

describe("global error listeners", () => {
  it("records an error surfaced via a window 'error' event", () => {
    const err = new Error("window error event");

    window.dispatchEvent(new ErrorEvent("error", { error: err }));

    expect(consumeLastCapturedError()).toBe(err);
  });

  it("falls back to the event itself when an 'error' event carries no error", () => {
    const event = new ErrorEvent("error", {});

    window.dispatchEvent(event);

    expect(consumeLastCapturedError()).toBe(event);
  });

  it("records a rejection reason surfaced via 'unhandledrejection'", () => {
    const reason = new Error("unhandled rejection");
    const event = new Event("unhandledrejection") as Event & { reason?: unknown };
    Object.defineProperty(event, "reason", { value: reason });

    window.dispatchEvent(event);

    expect(consumeLastCapturedError()).toBe(reason);
  });
});
