import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Board } from "@/features/tasks/components/Board";
import { api } from "@/services/api";
import type { Task } from "@/types";

// Render-count probe. Each card formats its own unique deadline, so counting
// formatInZone calls per deadline counts that card's TaskCardContent renders.
const renders = vi.hoisted(() => new Map<string, number>());
vi.mock("@/features/tasks/deadline", async () => {
  const actual = await vi.importActual<typeof import("@/features/tasks/deadline")>(
    "@/features/tasks/deadline",
  );
  return {
    ...actual,
    formatInZone: (iso: string, zone: string) => {
      renders.set(iso, (renders.get(iso) ?? 0) + 1);
      return actual.formatInZone(iso, zone);
    },
  };
});

const task = (n: number): Task => ({
  id: `t${n}`,
  title: `Card ${n}`,
  content: "Details",
  status: n <= 2 ? "todo" : n <= 4 ? "in_progress" : "done",
  category: "work",
  priority: "medium",
  deadlineAt: `2099-01-0${n}T10:00:00.000Z`,
  urls: [],
  markdownNote: "",
  position: n,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  completedAt: null,
  archivedAt: null,
});

afterEach(() => vi.restoreAllMocks());

describe("Board memoization", () => {
  it("does not re-render other cards when a task's detail sheet opens", async () => {
    const tasks = [1, 2, 3, 4, 5, 6].map(task);
    vi.spyOn(api, "getSettings").mockResolvedValue({
      timezone: "UTC",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    vi.spyOn(api, "listTasks").mockResolvedValue(tasks);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Board />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "Open task Card 6" });
    const before = new Map(renders);
    expect(before.size).toBe(6);

    fireEvent.click(screen.getByRole("button", { name: "Open task Card 3" }));
    await screen.findByRole("dialog");

    for (const t of tasks) {
      if (t.id === "t3") continue;
      expect(renders.get(t.deadlineAt!), t.title).toBe(before.get(t.deadlineAt!));
    }
  });
});
