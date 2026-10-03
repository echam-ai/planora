import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { selectProfile } from "@/services/api/profiles";
import { isAbortError, useCancellableRequest } from "./cancellation";

describe("isAbortError", () => {
  it("recognises the error a cancelled call rejects with, and nothing else", () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAbortError(controller.signal.reason)).toBe(true);
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(new DOMException("x", "NetworkError"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});

describe("useCancellableRequest", () => {
  it("abort() cancels the latest request, and is safe to repeat or call with none", () => {
    const { result } = renderHook(() => useCancellableRequest());
    expect(() => act(() => result.current.abort())).not.toThrow();
    const controller = result.current.begin();
    expect(controller.signal.aborted).toBe(false);

    act(() => result.current.abort());
    act(() => result.current.abort());

    expect(controller.signal.aborted).toBe(true);
    expect(result.current.isLatest(controller)).toBe(true);
  });

  it("begin() cancels the earlier request and makes the new one the latest", () => {
    const { result } = renderHook(() => useCancellableRequest());
    const first = result.current.begin();
    const second = result.current.begin();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(result.current.isLatest(second)).toBe(true);
    expect(result.current.isLatest(first)).toBe(false);
  });

  it("cancels on unmount", () => {
    const { result, unmount } = renderHook(() => useCancellableRequest());
    const controller = result.current.begin();
    unmount();
    expect(controller.signal.aborted).toBe(true);
  });

  it("cancels when the selected account changes", () => {
    const { result } = renderHook(() => useCancellableRequest());
    const controller = result.current.begin();

    act(() => selectProfile("ech_princess"));

    expect(controller.signal.aborted).toBe(true);
  });
});
