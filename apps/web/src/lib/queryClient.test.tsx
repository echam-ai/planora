import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, isNotAuthenticated, QUERY_STALE_TIME_MS } from "@/lib/queryClient";
import { useTasks } from "@/features/tasks/hooks";
import { api } from "@/services/api";
import { ApiError } from "@/types";

function TasksProbe() {
  useTasks();
  return null;
}

function mount(client: ReturnType<typeof createQueryClient>) {
  const wrap = (children: ReactNode) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(wrap(<TasksProbe />));
}

describe("createQueryClient", () => {
  it("defaults every query to a 30 second stale time", () => {
    expect(QUERY_STALE_TIME_MS).toBe(30_000);
    expect(createQueryClient().getDefaultOptions().queries?.staleTime).toBe(30_000);
  });

  it("gives each call its own client", () => {
    expect(createQueryClient()).not.toBe(createQueryClient());
  });
});

describe("query staleness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("serves a remount within 30 s from cache and refetches after that", async () => {
    const listTasks = vi.spyOn(api, "listTasks").mockResolvedValue([]);
    const client = createQueryClient();

    const first = mount(client);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(listTasks).toHaveBeenCalledTimes(1);
    first.unmount();

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    const second = mount(client);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(listTasks).toHaveBeenCalledTimes(1);
    second.unmount();

    await act(() => vi.advanceTimersByTimeAsync(31_000));
    mount(client);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(listTasks).toHaveBeenCalledTimes(2);
  });

  it("refetches on window focus once the data is stale", async () => {
    const listTasks = vi.spyOn(api, "listTasks").mockResolvedValue([]);
    const client = createQueryClient();
    mount(client);
    await act(() => vi.advanceTimersByTimeAsync(0));

    await act(async () => {
      window.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listTasks).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(31_000));
    await act(async () => {
      window.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listTasks).toHaveBeenCalledTimes(2);
  });
});

const notAuthenticated = () =>
  new ApiError("NOT_AUTHENTICATED", "Authentication is required.", { status: 401 });

describe("session expiry (#124)", () => {
  it("recognises only a 401 NOT_AUTHENTICATED ApiError", () => {
    expect(isNotAuthenticated(notAuthenticated())).toBe(true);
    expect(
      isNotAuthenticated(new ApiError("INVALID_PASSWORD", "Incorrect password.", { status: 401 })),
    ).toBe(false);
    expect(isNotAuthenticated(new ApiError("NOT_AUTHENTICATED", "Odd.", { status: 500 }))).toBe(
      false,
    );
    expect(isNotAuthenticated(new Error("NOT_AUTHENTICATED"))).toBe(false);
    expect(isNotAuthenticated(undefined)).toBe(false);
  });

  it("reports a failed query once, without retrying it", async () => {
    const onNotAuthenticated = vi.fn();
    const client = createQueryClient(onNotAuthenticated);
    const queryFn = vi.fn().mockRejectedValue(notAuthenticated());
    await client.fetchQuery({ queryKey: ["tasks"], queryFn }).catch(() => {});
    // No `retry: false` here: the client's own default must stop at the first 401.
    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(onNotAuthenticated).toHaveBeenCalledTimes(1);
  });

  it("reports a failed mutation", async () => {
    const onNotAuthenticated = vi.fn();
    const client = createQueryClient(onNotAuthenticated);
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(notAuthenticated()) })
      .execute(undefined)
      .catch(() => {});
    expect(onNotAuthenticated).toHaveBeenCalledTimes(1);
  });

  it("ignores every other failure, and retries them as before", async () => {
    const onNotAuthenticated = vi.fn();
    const client = createQueryClient(onNotAuthenticated);
    const wrong = new ApiError("INVALID_PASSWORD", "Incorrect password.", { status: 401 });
    await client
      .fetchQuery({ queryKey: ["a"], queryFn: () => Promise.reject(wrong), retry: false })
      .catch(() => {});
    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(new Error("boom")) })
      .execute(undefined)
      .catch(() => {});
    expect(onNotAuthenticated).not.toHaveBeenCalled();

    const retry = client.getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, new Error("offline"))).toBe(true);
    expect(retry(2, new Error("offline"))).toBe(true);
    expect(retry(3, new Error("offline"))).toBe(false);
    expect(retry(0, notAuthenticated())).toBe(false);
  });

  it("works without a callback", async () => {
    const client = createQueryClient();
    await client
      .fetchQuery({ queryKey: ["x"], queryFn: () => Promise.reject(notAuthenticated()) })
      .catch(() => {});
    expect(client.getQueryCache().find({ queryKey: ["x"] })?.state.status).toBe("error");
  });
});
