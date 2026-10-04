import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTaskMutations } from "./hooks";
import { selectProfile } from "@/services/api/profiles";
import { ACCESS_KEY } from "@/services/api/mock/access";
import { createMockApiClient } from "@/services/api/mockApiClient";
import { qk } from "@/shared/queryKeys";
afterEach(() => vi.useRealTimers());
it("a pending move retains its account and writes only to its original cache", async () => {
  localStorage.clear();
  localStorage.setItem(ACCESS_KEY, "1");
  vi.useFakeTimers();
  selectProfile("hamster_knight");
  const knight = createMockApiClient("hamster_knight"),
    princess = createMockApiClient("ech_princess");
  const pendingTask = knight.createTask({
    title: "Origin",
    content: "Kept",
    category: "other",
    priority: "medium",
    deadlineAt: null,
    urls: [],
    markdownNote: "",
  });
  await vi.runAllTimersAsync();
  const task = await pendingTask;
  let mutations: ReturnType<typeof useTaskMutations>;
  function Harness() {
    mutations = useTaskMutations();
    return null;
  }
  const oldCache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }),
    newCache = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const view = render(
    <QueryClientProvider client={oldCache}>
      <Harness />
    </QueryClientProvider>,
  );
  act(() => mutations.move.mutate({ id: task.id, status: "done", position: 0 }));
  act(() => selectProfile("ech_princess"));
  view.rerender(
    <QueryClientProvider key="princess" client={newCache}>
      <Harness />
    </QueryClientProvider>,
  );
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  expect(newCache.getQueryData(qk.tasks)).toBeUndefined();
  expect(oldCache.getQueryData(qk.tasks)).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: task.id, status: "done" })]),
  );
  const pendingPrincess = princess.listTasks();
  await vi.runAllTimersAsync();
  expect(await pendingPrincess).toEqual([]);
  vi.useRealTimers();
  await waitFor(() => expect(oldCache.getQueryData(qk.tasks)).toBeDefined());
});
