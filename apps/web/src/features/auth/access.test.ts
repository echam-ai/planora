import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import {
  getAccessState,
  refreshAccess,
  resetAccessState,
  setAccessState,
  useAccessState,
} from "./access";

beforeEach(() => resetAccessState());
afterEach(() => vi.restoreAllMocks());

describe("access state", () => {
  it("starts unknown, as on the server and in the first browser render", () => {
    expect(getAccessState()).toBe("unknown");
    const { result } = renderHook(() => useAccessState());
    expect(result.current).toBe("unknown");
  });

  it("notifies subscribers once per real change", () => {
    const { result } = renderHook(() => useAccessState());
    act(() => setAccessState("locked"));
    expect(result.current).toBe("locked");
    act(() => setAccessState("locked"));
    act(() => setAccessState("unlocked"));
    expect(result.current).toBe("unlocked");
  });

  it("records the API's answer", async () => {
    vi.spyOn(api, "getAccess").mockResolvedValueOnce({ authenticated: true });
    await refreshAccess();
    expect(getAccessState()).toBe("unlocked");
    vi.spyOn(api, "getAccess").mockResolvedValueOnce({ authenticated: false });
    await refreshAccess();
    expect(getAccessState()).toBe("locked");
  });

  it("marks the state unreachable when the question itself fails", async () => {
    vi.spyOn(api, "getAccess").mockRejectedValueOnce(new Error("offline"));
    await refreshAccess();
    expect(getAccessState()).toBe("unreachable");
  });

  it("lets a newer fact win over a slow older answer", async () => {
    let answer!: (value: { authenticated: boolean }) => void;
    vi.spyOn(api, "getAccess").mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const pending = refreshAccess();
    setAccessState("unlocked"); // the user unlocked while the first check was in flight
    answer({ authenticated: false });
    await pending;
    expect(getAccessState()).toBe("unlocked");

    vi.spyOn(api, "getAccess").mockReturnValueOnce(Promise.reject(new Error("late failure")));
    const failing = refreshAccess();
    setAccessState("locked");
    await failing;
    expect(getAccessState()).toBe("locked");
  });
});
