import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { Board } from "@/features/tasks/components/Board";
import { api } from "@/services/api";
import { ApiError, type Task } from "@/types";

// Board drives dnd-kit through pointer/keyboard sensors, neither of which is
// reproducible in jsdom. dnd-kit's own drag detection is third-party and out
// of scope here; what belongs to this issue is Board's onDragStart/onDragEnd
// business logic (reorder vs. cross-column move, and the no-op guards). This
// mock captures the real callbacks Board hands to DndContext and renders its
// children exactly as Board does, so every other dnd-kit hook used deeper in
// the tree (useDroppable, useSortable) still runs for real.
type Handlers = {
  onDragStart: ((event: DragStartEvent) => void) | undefined;
  onDragEnd: ((event: DragEndEvent) => void) | undefined;
  onDragCancel: (() => void) | undefined;
};
const handlers: Handlers = {
  onDragStart: undefined,
  onDragEnd: undefined,
  onDragCancel: undefined,
};

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  return {
    ...actual,
    DndContext: (props: {
      children: ReactNode;
      onDragStart?: Handlers["onDragStart"];
      onDragEnd?: Handlers["onDragEnd"];
      onDragCancel?: Handlers["onDragCancel"];
    }) => {
      handlers.onDragStart = props.onDragStart;
      handlers.onDragEnd = props.onDragEnd;
      handlers.onDragCancel = props.onDragCancel;
      return props.children;
    },
  };
});

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    content: "Details",
    status: "todo",
    category: "work",
    priority: "medium",
    deadlineAt: null,
    urls: [],
    markdownNote: "",
    position: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

let qc: QueryClient;

function renderBoard(tasks: Task[]) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(api, "getSettings").mockResolvedValue({
    timezone: "UTC",
    modelName: "kimi-k3",
    availableModels: ["kimi-k3"],
  });
  const listTasks = vi.spyOn(api, "listTasks").mockResolvedValue(tasks);
  return {
    listTasks,
    ...render(
      <QueryClientProvider client={qc}>
        <Board />
      </QueryClientProvider>,
    ),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  handlers.onDragStart = undefined;
  handlers.onDragEnd = undefined;
  handlers.onDragCancel = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  qc?.clear();
});

describe("Board", () => {
  it("combines search and filters, resets empty results, and preserves manual order without writes", async () => {
    const tasks = [
      makeTask({
        id: "second",
        title: "Second notes",
        position: 1,
        category: "personal",
        priority: "low",
      }),
      makeTask({ id: "first", title: "First notes", position: 0, priority: "high" }),
      makeTask({ id: "third", title: "Third notes", position: 2, category: "study" }),
    ];
    const reorderTasks = vi.spyOn(api, "reorderTasks");
    const moveTask = vi.spyOn(api, "moveTask");
    renderBoard(tasks);
    await screen.findByRole("button", { name: "Open task Third notes" });
    const toolbar = within(screen.getByRole("region", { name: "Board filters" }));
    // Task cards expose explicit labels. Label lookup avoids recomputing every
    // board button's accessible name/style on each order check; keep role and
    // visibility assertions on the exact same cards.
    const titles = () =>
      screen.getAllByLabelText(/^Open task /, { selector: "button" }).map((button) => {
        expect(button).toHaveRole("button");
        expect(button).toBeVisible();
        return button.getAttribute("aria-label");
      });
    const original = titles();
    expect(original).toEqual([
      "Open task First notes",
      "Open task Second notes",
      "Open task Third notes",
    ]);
    for (const [dimension, choices] of [
      ["Category", ["Work", "Personal"]],
      ["Priority", ["High", "Low"]],
      ["Deadline", ["No deadline"]],
    ] as const) {
      fireEvent.click(toolbar.getByRole("button", { name: dimension }));
      const popover = within(screen.getByRole("dialog", { name: `${dimension} filters` }));
      for (const name of choices) fireEvent.click(popover.getByRole("button", { name }));
    }
    expect(titles()).toEqual(original.slice(0, 2));
    fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "SECOND" } });
    expect(titles()).toEqual(["Open task Second notes"]);
    fireEvent.click(toolbar.getByRole("button", { name: "Category 2" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Category filters" })).getByRole("button", {
        name: "Personal",
      }),
    );
    expect(screen.queryByRole("button", { name: /^Open task / })).not.toBeInTheDocument();
    fireEvent.click(toolbar.getByRole("button", { name: "Clear all filters" }));
    expect(titles()).toEqual(original);
    expect(screen.getByLabelText("Search tasks")).toHaveValue("");
    expect(reorderTasks).not.toHaveBeenCalled();
    expect(moveTask).not.toHaveBeenCalled();
    expect(qc.getQueryData(["tasks"])).toEqual(tasks);
  });

  it("shows an error state and reloads the board through Try again", async () => {
    const listTasks = vi
      .spyOn(api, "listTasks")
      .mockRejectedValueOnce(new ApiError("NETWORK", "down"));
    vi.spyOn(api, "getSettings").mockResolvedValue({
      timezone: "UTC",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Board />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("We couldn't load your tasks.")).toBeInTheDocument();
    listTasks.mockResolvedValueOnce([makeTask({ id: "a", title: "First todo" })]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "Open task First todo" })).toBeInTheDocument();
  });

  it("shows a refreshing indicator during a background refetch without hiding the board", async () => {
    const task = makeTask({ id: "a", title: "First todo" });
    const { listTasks } = renderBoard([task]);
    await screen.findByRole("button", { name: "Open task First todo" });

    const refetchDeferred = deferred<Task[]>();
    listTasks.mockReturnValueOnce(refetchDeferred.promise);
    // Don't await: invalidateQueries only resolves once the refetch settles,
    // and this test needs to observe the board mid-refetch.
    act(() => {
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    });

    expect(await screen.findByLabelText("Refreshing")).toBeInTheDocument();
    // the previously loaded board stays visible during the background refetch
    expect(screen.getByRole("button", { name: "Open task First todo" })).toBeInTheDocument();
    await act(async () => {
      refetchDeferred.resolve([task]);
    });
    await waitFor(() => expect(screen.queryByLabelText("Refreshing")).not.toBeInTheDocument());
  });

  it("moves a task to another column and calls the mutation with the target status and end position", async () => {
    const todo = makeTask({ id: "t1", title: "First todo", status: "todo", position: 0 });
    const inProgress = makeTask({
      id: "t3",
      title: "In progress task",
      status: "in_progress",
      position: 0,
    });
    const moveTask = vi
      .spyOn(api, "moveTask")
      .mockResolvedValue([{ ...todo, status: "in_progress", position: 1 }, inProgress]);
    renderBoard([todo, inProgress]);
    await screen.findByRole("button", { name: "Open task First todo" });

    act(() => handlers.onDragStart!({ active: { id: "t1" } } as DragStartEvent));
    act(() =>
      handlers.onDragEnd!({
        active: { id: "t1" },
        over: { id: "column:in_progress" },
      } as unknown as DragEndEvent),
    );

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith("t1", "in_progress", 1));
  });

  it("reorders a task within its column and calls the mutation with the new order", async () => {
    const first = makeTask({ id: "t1", title: "First todo", status: "todo", position: 0 });
    const second = makeTask({ id: "t2", title: "Second todo", status: "todo", position: 1 });
    const reorderTasks = vi.spyOn(api, "reorderTasks").mockResolvedValue([first, second]);
    renderBoard([first, second]);
    await screen.findByRole("button", { name: "Open task Second todo" });

    act(() => handlers.onDragStart!({ active: { id: "t2" } } as DragStartEvent));
    act(() =>
      handlers.onDragEnd!({ active: { id: "t2" }, over: { id: "t1" } } as unknown as DragEndEvent),
    );

    await waitFor(() => expect(reorderTasks).toHaveBeenCalledWith("todo", ["t2", "t1"]));
  });

  it("ignores a drop with no target and a drop back onto its own spot", async () => {
    const first = makeTask({ id: "t1", title: "First todo", status: "todo", position: 0 });
    const second = makeTask({ id: "t2", title: "Second todo", status: "todo", position: 1 });
    const moveTask = vi.spyOn(api, "moveTask");
    const reorderTasks = vi.spyOn(api, "reorderTasks");
    renderBoard([first, second]);
    await screen.findByRole("button", { name: "Open task First todo" });

    act(() => handlers.onDragStart!({ active: { id: "t1" } } as DragStartEvent));
    act(() => handlers.onDragEnd!({ active: { id: "t1" }, over: null } as unknown as DragEndEvent));
    expect(moveTask).not.toHaveBeenCalled();
    expect(reorderTasks).not.toHaveBeenCalled();

    act(() => handlers.onDragStart!({ active: { id: "t1" } } as DragStartEvent));
    act(() =>
      handlers.onDragEnd!({ active: { id: "t1" }, over: { id: "t1" } } as unknown as DragEndEvent),
    );
    expect(moveTask).not.toHaveBeenCalled();
    expect(reorderTasks).not.toHaveBeenCalled();
  });

  it("leaves the board interactive after a drag is cancelled mid-flight", async () => {
    const first = makeTask({ id: "t1", title: "First todo", status: "todo", position: 0 });
    renderBoard([first]);
    await screen.findByRole("button", { name: "Open task First todo" });

    act(() => handlers.onDragStart!({ active: { id: "t1" } } as DragStartEvent));
    act(() => handlers.onDragCancel!());

    expect(screen.getByRole("button", { name: "Open task First todo" })).toBeInTheDocument();
  });

  it("keeps the board usable when a move or a reorder mutation fails", async () => {
    const first = makeTask({ id: "t1", title: "First todo", status: "todo", position: 0 });
    const inProgress = makeTask({ id: "t3", title: "In progress task", status: "in_progress" });
    const moveTask = vi
      .spyOn(api, "moveTask")
      .mockRejectedValueOnce(new ApiError("NETWORK", "Couldn't move that task"));
    renderBoard([first, inProgress]);
    await screen.findByRole("button", { name: "Open task First todo" });

    act(() => handlers.onDragStart!({ active: { id: "t1" } } as DragStartEvent));
    act(() =>
      handlers.onDragEnd!({
        active: { id: "t1" },
        over: { id: "column:in_progress" },
      } as unknown as DragEndEvent),
    );

    await waitFor(() => expect(moveTask).toHaveBeenCalledTimes(1));
    // the board is still interactive after the failed mutation
    expect(await screen.findByRole("button", { name: "Open task First todo" })).toBeInTheDocument();
  });
});
