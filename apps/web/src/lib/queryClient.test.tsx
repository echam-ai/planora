import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient, QUERY_STALE_TIME_MS } from "@/lib/queryClient";
import { useTasks } from "@/features/tasks/hooks";
import { api } from "@/services/api";

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
