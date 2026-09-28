import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "@/hooks/use-mobile";

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

function installMatchMedia(matches: boolean) {
  let onChange: (() => void) | undefined;
  const removeEventListener = vi.fn();
  const mql = {
    matches,
    addEventListener: (_event: string, listener: () => void) => {
      onChange = listener;
    },
    removeEventListener,
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    removeEventListener,
    fireChange: () => onChange?.(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useIsMobile", () => {
  it("reports desktop for a viewport at or above the breakpoint", () => {
    installMatchMedia(false);
    setWidth(1024);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });

  it("reports mobile for a viewport under the breakpoint", () => {
    installMatchMedia(true);
    setWidth(500);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it("switches from desktop to mobile when the viewport narrows", () => {
    const { fireChange } = installMatchMedia(false);
    setWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    setWidth(500);
    act(() => fireChange());

    expect(result.current).toBe(true);
  });

  it("removes the media query listener on unmount", () => {
    const { removeEventListener } = installMatchMedia(false);
    setWidth(1024);
    const { unmount } = renderHook(() => useIsMobile());

    expect(removeEventListener).not.toHaveBeenCalled();
    unmount();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });
});
