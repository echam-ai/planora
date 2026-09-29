import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { qk } from "@/shared/queryKeys";
import { api } from "@/services/api";
import { ApiError, type Conversation, type Task, type TaskDraft } from "@/types";

vi.mock("@tanstack/react-router", async () => {
  const ReactModule = await import("react");
  return {
    createFileRoute: () => (options: unknown) => ({ options }),
    Link: ({
      to,
      children,
      ...rest
    }: {
      to: string;
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => ReactModule.createElement("a", { href: to, ...rest }, children),
    useNavigate: () => () => undefined,
  };
});

const TasksPage = (
  (await import("@/routes/tasks")) as unknown as {
    Route: { options: { component: React.ComponentType } };
  }
).Route.options.component;

const ArchivePage = (
  (await import("@/routes/archive")) as unknown as {
    Route: { options: { component: React.ComponentType } };
  }
).Route.options.component;

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    content: "Original content",
    status: "todo",
    category: "work",
    priority: "medium",
    deadlineAt: null,
    urls: [],
    markdownNote: "",
    position: 0,
    createdAt: iso(-7 * DAY),
    updatedAt: iso(-2 * HOUR),
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

type Store = { tasks: Task[]; pendingAction?: { taskId: string; draft: TaskDraft } };

let store: Store;
let updateTask: ReturnType<typeof vi.spyOn>;
let deleteTask: ReturnType<typeof vi.spyOn>;
let getArchivedTask: ReturnType<typeof vi.spyOn>;
let listArchive: ReturnType<typeof vi.spyOn>;
let restoreTask: ReturnType<typeof vi.spyOn>;
let permanentlyDeleteTask: ReturnType<typeof vi.spyOn>;
let qc: QueryClient;

function installClient(seed: Task[]) {
  store = { tasks: seed };
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

  vi.spyOn(api, "getSession").mockResolvedValue({ username: "demo", signedInAt: iso(-HOUR) });
  vi.spyOn(api, "getSettings").mockResolvedValue({
    timezone: "UTC",
    modelName: "kimi-k3",
    availableModels: ["kimi-k3"],
  });
  vi.spyOn(api, "listTasks").mockImplementation(async () =>
    store.tasks.filter((t) => !t.archivedAt),
  );
  listArchive = vi.spyOn(api, "listArchive").mockImplementation(async (search = "", page = 1) => {
    const pageSize = 10;
    const matching = store.tasks.filter(
      (t) => t.archivedAt && t.title.toLowerCase().includes(search.trim().toLowerCase()),
    );
    return {
      items: matching.slice((page - 1) * pageSize, page * pageSize),
      total: matching.length,
      page,
      pageSize,
    };
  });
  getArchivedTask = vi.spyOn(api, "getArchivedTask").mockImplementation(async (id) => {
    const task = store.tasks.find((t) => t.id === id && t.archivedAt);
    if (!task) throw new ApiError("NOT_FOUND", "That archived task no longer exists.");
    return task;
  });
  updateTask = vi
    .spyOn(api, "updateTask")
    .mockImplementation(async (id, patch) => applyPatch(id, patch));
  deleteTask = vi.spyOn(api, "deleteTask").mockImplementation(async (id) => {
    store.tasks = store.tasks.filter((t) => t.id !== id);
  });
  restoreTask = vi.spyOn(api, "restoreTask").mockImplementation(async (id) => {
    const restored = {
      ...requireTask(id),
      archivedAt: null,
      completedAt: null,
      status: "todo" as const,
      updatedAt: iso(0),
    };
    store.tasks = store.tasks.map((task) => (task.id === id ? restored : task));
    return restored;
  });
  permanentlyDeleteTask = vi.spyOn(api, "permanentlyDeleteTask").mockImplementation(async (id) => {
    store.tasks = store.tasks.filter((task) => task.id !== id);
  });
  vi.spyOn(api, "moveTask").mockImplementation(async (id, status, position) => {
    const task = requireTask(id);
    task.status = status;
    task.position = position;
    task.updatedAt = iso(0);
    if (status === "done" && !task.completedAt) task.completedAt = iso(0);
    if (status !== "done") task.completedAt = null;
    return store.tasks.filter((t) => !t.archivedAt);
  });
  vi.spyOn(api, "sendChatMessage").mockImplementation(async (): Promise<Conversation> => ({
    id: "conv",
    messages: [
      {
        id: "msg1",
        role: "assistant",
        text: "I'd update this task as follows.",
        createdAt: iso(0),
        ...(store.pendingAction
          ? {
              action: {
                id: "act1",
                kind: "update" as const,
                title: "Update task",
                summary: "chat write",
                fields: [],
                status: "pending" as const,
                payload: {
                  taskId: store.pendingAction.taskId,
                  draft: store.pendingAction.draft,
                },
              },
            }
          : {}),
      },
    ],
  }));
  // A confirmed chat write applies the proposed draft exactly as the mock
  // client's confirmChatAction does (full-draft update of the target task).
  vi.spyOn(api, "confirmChatAction").mockImplementation(async () => {
    if (store.pendingAction) {
      const { taskId, draft } = store.pendingAction;
      applyPatch(taskId, { ...draft });
      delete store.pendingAction;
    }
    return { id: "conv", messages: [] };
  });
}

function requireTask(id: string): Task {
  const task = store.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`no task ${id}`);
  return task;
}

function applyPatch(id: string, patch: Partial<TaskDraft> & { status?: Task["status"] }): Task {
  const task = { ...requireTask(id) };
  Object.assign(task, patch, { updatedAt: iso(0) });
  if (patch.status === "done" && !task.completedAt) task.completedAt = iso(0);
  if (patch.status && patch.status !== "done") task.completedAt = null;
  store.tasks = store.tasks.map((t) => (t.id === id ? task : t));
  return task;
}

/** A write that reaches the task store from elsewhere, as a board drag or a
 * confirmed chat write produces: mutate the store, then invalidate the way
 * `useTaskMutations` / `useChatMutations` do. */
async function externalWrite(mutate: () => void | Promise<unknown>) {
  await mutate();
  await qc.invalidateQueries({ queryKey: qk.tasks });
  await qc.invalidateQueries({ queryKey: ["archive"] });
}

function renderPage(Page: React.ComponentType) {
  return render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>,
  );
}

async function openSheet(title: string) {
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: new RegExp(`Open (archived )?task ${title}`) },
      { timeout: 5_000 },
    ),
  );
  return screen.findByRole("dialog");
}

function field(scope: HTMLElement, name: string) {
  return within(scope).getByLabelText(name);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function hiddenButton(name: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  if (!button) throw new Error(`missing button: ${name}`);
  return button;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  qc?.clear();
});

describe("task detail sheet", () => {
  it("scenario 1: shows a status change made through the client store without reopening", async () => {
    installClient([makeTask({ id: "a", title: "Ship it", status: "todo" })]);
    renderPage(TasksPage);

    const dialog = await openSheet("Ship it");
    await waitFor(() => {
      expect(within(dialog).getByRole("combobox", { name: "Status" })).toHaveTextContent("Todo");
    });

    // a board drag produces exactly this client-store move
    await externalWrite(() => api.moveTask("a", "in_progress", 0));

    await waitFor(() => {
      expect(within(dialog).getByRole("combobox", { name: "Status" })).toHaveTextContent(
        "In Progress",
      );
    });
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("scenario 2: Save sends only the edited field", async () => {
    installClient([makeTask({ id: "a", title: "Ship it" })]);
    renderPage(TasksPage);

    const dialog = await openSheet("Ship it");
    fireEvent.change(field(dialog, "Title"), { target: { value: "Ship it v2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    expect(updateTask).toHaveBeenCalledWith("a", { title: "Ship it v2" });
  });

  it("scenario 3 / AC 4: Save never reverts externally-written values", async () => {
    installClient([
      makeTask({
        id: "a",
        title: "Old title",
        content: "Old content",
        category: "work",
        priority: "low",
        deadlineAt: iso(3 * DAY),
        markdownNote: "old note",
        urls: [{ id: "u1", url: "https://a.example", label: "Alpha" }],
      }),
    ]);
    renderPage(TasksPage);

    const dialog = await openSheet("Old title");
    fireEvent.change(field(dialog, "Title"), { target: { value: "User title" } });

    // every field the user has not edited changes underneath the open sheet
    const completedAt = iso(-DAY);
    await externalWrite(() => {
      store.tasks = store.tasks.map((t) =>
        t.id === "a"
          ? {
              ...t,
              title: "External title",
              content: "External content",
              category: "personal",
              priority: "high",
              deadlineAt: iso(5 * DAY),
              markdownNote: "external note",
              urls: [{ id: "u1", url: "https://b.example", label: "Bravo" }],
              status: "done",
              completedAt,
              updatedAt: iso(0),
            }
          : t,
      );
    });

    // untouched fields display the external write at once
    await waitFor(() => {
      expect(within(dialog).getByLabelText("Content")).toHaveValue("External content");
      expect(within(dialog).getByRole("combobox", { name: "Category" })).toHaveTextContent(
        "Personal",
      );
      expect(within(dialog).getByRole("combobox", { name: "Priority" })).toHaveTextContent("High");
      expect(within(dialog).getByRole("combobox", { name: "Status" })).toHaveTextContent("Done");
    });
    // the field the user edited keeps the user's value
    expect(within(dialog).getByLabelText("Title")).toHaveValue("User title");

    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    expect(updateTask).toHaveBeenCalledWith("a", { title: "User title" });

    const stored = requireTask("a");
    expect(stored).toMatchObject({
      title: "User title",
      content: "External content",
      category: "personal",
      priority: "high",
      markdownNote: "external note",
      urls: [{ id: "u1", url: "https://b.example", label: "Bravo" }],
      status: "done",
      completedAt,
    });
  });

  it("scenario 4: in-progress edits survive external writes", async () => {
    installClient([makeTask({ id: "a", title: "Ship it", priority: "medium" })]);
    renderPage(TasksPage);

    const dialog = await openSheet("Ship it");
    fireEvent.change(field(dialog, "Title"), { target: { value: "My own title" } });

    await externalWrite(() => {
      store.tasks = store.tasks.map((t) =>
        t.id === "a" ? { ...t, priority: "high", updatedAt: iso(0) } : t,
      );
    });

    await waitFor(() => {
      expect(within(dialog).getByRole("combobox", { name: "Priority" })).toHaveTextContent("High");
    });
    expect(within(dialog).getByLabelText("Title")).toHaveValue("My own title");
  });

  it("scenario 8 (store-level fallback): a confirmed chat write lands in the open sheet and Save does not revert it", async () => {
    installClient([
      makeTask({ id: "a", title: "Ship it", priority: "medium", content: "Old content" }),
    ]);
    store.pendingAction = {
      taskId: "a",
      draft: {
        title: "Ship it",
        content: "Chat-written content",
        category: "work",
        priority: "low",
        deadlineAt: null,
        urls: [],
        markdownNote: "chat note",
      },
    };
    renderPage(TasksPage);

    const dialog = await openSheet("Ship it");
    fireEvent.change(field(dialog, "Title"), { target: { value: "My own title" } });

    // the user confirms the chat write (the mock client's proposed update action)
    await externalWrite(async () => {
      await api.sendChatMessage("set priority low for Ship it");
      await api.confirmChatAction("act1");
    });

    await waitFor(() => {
      expect(within(dialog).getByRole("combobox", { name: "Priority" })).toHaveTextContent("Low");
      expect(within(dialog).getByLabelText("Content")).toHaveValue("Chat-written content");
    });
    expect(within(dialog).getByLabelText("Title")).toHaveValue("My own title");

    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    expect(updateTask).toHaveBeenCalledWith("a", { title: "My own title" });

    const stored = requireTask("a");
    expect(stored).toMatchObject({
      title: "My own title",
      content: "Chat-written content",
      priority: "low",
      markdownNote: "chat note",
    });
  });

  it("scenario 9: Cancel and an empty Save issue no update request", async () => {
    installClient([makeTask({ id: "a", title: "Ship it" })]);
    renderPage(TasksPage);

    const dialog = await openSheet("Ship it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(updateTask).not.toHaveBeenCalled();

    const reopened = await openSheet("Ship it");
    fireEvent.click(within(reopened).getByRole("button", { name: "Save changes" }));
    // let any (buggy) update request surface before asserting there was none
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("AC 5: status is included only when the user changed it", async () => {
    installClient([makeTask({ id: "a", title: "Ship it", status: "todo" })]);
    renderPage(TasksPage);

    const dialog = await openSheet("Ship it");
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Done" }));
    await waitFor(() => {
      expect(within(dialog).getByRole("combobox", { name: "Status" })).toHaveTextContent("Done");
    });
    fireEvent.change(field(dialog, "Title"), { target: { value: "Ship it v2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    const [, patch] = updateTask.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch["status"]).toBe("done");
    expect(Object.keys(patch).sort()).toEqual(["status", "title"]);
  });

  it("issue #19 rework: clears an existing deadline through the Clear deadline button and shows no deadline on the card", async () => {
    installClient([makeTask({ id: "a", title: "Ship it", deadlineAt: iso(3 * DAY) })]);
    renderPage(TasksPage);

    const dialog = await openSheet("Ship it");
    const clearButton = await within(dialog).findByRole("button", { name: "Clear deadline" });
    fireEvent.click(clearButton);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    expect(updateTask).toHaveBeenCalledWith("a", { deadlineAt: null });
    expect(requireTask("a").deadlineAt).toBeNull();

    const card = await screen.findByRole("button", { name: "Open task Ship it" });
    expect(within(card).getByText("No deadline")).toBeInTheDocument();
  });

  it("AC 3: sheet chrome and the read-only archive view track the current task", async () => {
    installClient([
      makeTask({
        id: "a",
        title: "Ship it",
        urls: [{ id: "u1", url: "https://a.example", label: "Alpha" }],
      }),
      makeTask({
        id: "z",
        title: "Archived task",
        content: "Archived content",
        archivedAt: iso(-DAY),
        status: "done",
        completedAt: iso(-DAY),
      }),
    ]);

    // edit view: header title and links list follow the task, not the click-time snapshot
    const taskPage = renderPage(TasksPage);
    let dialog = await openSheet("Ship it");
    await externalWrite(() => {
      store.tasks = store.tasks.map((t) =>
        t.id === "a"
          ? {
              ...t,
              title: "Renamed task",
              urls: [{ id: "u1", url: "https://a.example", label: "Renamed link" }],
              updatedAt: iso(0),
            }
          : t,
      );
    });
    expect(await screen.findByRole("dialog", { name: "Renamed task" })).toBeInTheDocument();
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Renamed link")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Renamed task");
    taskPage.unmount();
    qc.clear();

    // read-only archive view follows the task too
    renderPage(ArchivePage);
    dialog = await openSheet("Archived task");
    expect(await within(dialog).findByText("Archived content")).toBeInTheDocument();
    expect(within(dialog).getByText("Completed", { selector: "span" })).toBeInTheDocument();
    await externalWrite(() => {
      store.tasks = store.tasks.map((t) =>
        t.id === "z" ? { ...t, content: "Rewritten while open" } : t,
      );
    });
    await waitFor(() => {
      expect(within(dialog).getByText("Rewritten while open")).toBeInTheDocument();
    });
  });

  it("AC 8: a Done task with a past deadline stays Done and completed through Save", async () => {
    const completedAt = iso(-3 * DAY);
    installClient([
      makeTask({
        id: "a",
        title: "Weekly status update",
        status: "done",
        deadlineAt: iso(-2 * DAY),
        completedAt,
      }),
    ]);
    renderPage(TasksPage);

    const dialog = await openSheet("Weekly status update");
    await waitFor(() => {
      expect(within(dialog).getByRole("combobox", { name: "Status" })).toHaveTextContent("Done");
    });
    expect(within(dialog).getByText("Completed", { selector: "span" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Date/ })).not.toHaveTextContent(
      "Pick a date",
    );
    expect(within(dialog).getByLabelText("Time")).not.toHaveValue("");
    expect(within(dialog).getByText("Completed", { selector: "dt" })).toBeInTheDocument();

    fireEvent.change(field(dialog, "Content"), { target: { value: "Edited content" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    expect(updateTask).toHaveBeenCalledWith("a", { content: "Edited content" });
    expect(requireTask("a")).toMatchObject({
      status: "done",
      completedAt,
      content: "Edited content",
    });

    // the card renders the Completed state, not a timing-based deadline state
    const card = await screen.findByRole("button", { name: "Open task Weekly status update" });
    expect(within(card).getByText("Completed")).toBeInTheDocument();
  });

  it("returns a saved Done task with a past deadline to To do as overdue", async () => {
    installClient([
      makeTask({
        id: "a",
        title: "Recover the overdue task",
        status: "done",
        deadlineAt: iso(-DAY),
        completedAt: iso(-2 * DAY),
      }),
    ]);
    renderPage(TasksPage);

    let dialog = await openSheet("Recover the overdue task");
    expect(within(dialog).getByText("Completed", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Status" }));
    fireEvent.click(await screen.findByRole("option", { name: "Todo" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith("a", { status: "todo" }));
    expect(requireTask("a")).toMatchObject({ status: "todo", completedAt: null });
    const card = await screen.findByRole("button", { name: "Open task Recover the overdue task" });
    expect(within(card).getByText("Overdue")).toBeInTheDocument();

    dialog = await openSheet("Recover the overdue task");
    expect(within(dialog).getByText("Overdue", { selector: "span" })).toBeInTheDocument();
    expect(within(dialog).queryByText("Completed", { selector: "dt" })).not.toBeInTheDocument();
  });

  it("AC 12: Delete acts only on explicit confirmation", async () => {
    installClient([makeTask({ id: "a", title: "Ship it" })]);
    renderPage(TasksPage);

    const dialog = await openSheet("Ship it");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/Delete “Ship it”\?/)).toBeInTheDocument();
    expect(deleteTask).not.toHaveBeenCalled();

    fireEvent.click(within(confirm).getByRole("button", { name: "Keep task" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(deleteTask).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    const confirmAgain = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirmAgain).getByRole("button", { name: "Delete task" }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("a"));
  });

  it("archive scenario 1: keeps detail open and fresh when search excludes the selected task", async () => {
    installClient([
      makeTask({
        id: "a",
        title: "Release notes",
        content: "Original archive content",
        status: "done",
        completedAt: iso(-2 * DAY),
        archivedAt: iso(-DAY),
      }),
    ]);
    renderPage(ArchivePage);

    fireEvent.change(await screen.findByLabelText("Search archived tasks"), {
      target: { value: "RELEASE" },
    });
    const dialog = await openSheet("Release notes");
    expect(await within(dialog).findByText("Original archive content")).toBeInTheDocument();

    await externalWrite(() => {
      store.tasks = store.tasks.map((task) =>
        task.id === "a"
          ? { ...task, title: "Retrospective", content: "Refreshed archive content" }
          : task,
      );
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Open archived task Retrospective/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Retrospective" })).toBe(dialog);
      expect(within(dialog).getByText("Refreshed archive content")).toBeInTheDocument();
    });
    expect(getArchivedTask).toHaveBeenCalledWith("a");
  });

  it("archive scenario 2: keeps detail open when the active page changes", async () => {
    const archived = Array.from({ length: 11 }, (_, index) =>
      makeTask({
        id: `archived-${index}`,
        title: `Archived ${index}`,
        status: "done",
        completedAt: iso(-(index + 2) * DAY),
        archivedAt: iso(-(index + 1) * DAY),
      }),
    );
    installClient(archived);
    renderPage(ArchivePage);

    const dialog = await openSheet("Archived 0");
    expect(await screen.findByRole("dialog", { name: "Archived 0" })).toBe(dialog);
    // The sheet is modal; the route still retains selection when a page-key
    // change arrives underneath it.
    fireEvent.click(screen.getByText("Next", { selector: "button" }));

    await waitFor(() => {
      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Open archived task Archived 0" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Archived 0" })).toBe(dialog);
    });
  });

  it("archive scenario 3: list failures and empty pages do not dismiss an open detail", async () => {
    installClient([
      makeTask({
        id: "a",
        title: "Archived A",
        status: "done",
        completedAt: iso(-2 * DAY),
        archivedAt: iso(-DAY),
      }),
    ]);
    renderPage(ArchivePage);
    const dialog = await openSheet("Archived A");
    expect(await screen.findByRole("dialog", { name: "Archived A" })).toBe(dialog);

    listArchive.mockRejectedValueOnce(new ApiError("NETWORK", "Archive unavailable"));
    await qc.invalidateQueries({ queryKey: qk.archive("", 1) });
    await waitFor(() =>
      expect(screen.getByText("We couldn't load the archive.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("dialog", { name: "Archived A" })).toBe(dialog);

    listArchive.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 });
    await qc.invalidateQueries({ queryKey: qk.archive("", 1) });
    await waitFor(() => expect(screen.getByText("Nothing archived yet.")).toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Archived A" })).toBe(dialog);
  });

  it("archive scenarios 4–5: holds selection through loading, errors, and retry", async () => {
    installClient([
      makeTask({
        id: "a",
        title: "Archived A",
        content: "Current content",
        status: "done",
        completedAt: iso(-2 * DAY),
        archivedAt: iso(-DAY),
      }),
    ]);
    const initial = deferred<Task>();
    getArchivedTask.mockImplementationOnce(() => initial.promise);
    renderPage(ArchivePage);

    fireEvent.click(await screen.findByRole("button", { name: "Open archived task Archived A" }));
    const dialog = await screen.findByRole("dialog", { name: "Archived task" });
    expect(within(dialog).getByText("Loading archived task…")).toBeInTheDocument();

    await act(async () => initial.resolve(requireTask("a")));
    expect(await screen.findByRole("dialog", { name: "Archived A" })).toBe(dialog);

    getArchivedTask.mockRejectedValueOnce(new ApiError("NETWORK", "Connection lost"));
    await externalWrite(() => undefined);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Connection lost");
    expect(within(dialog).getByText("Current content")).toBeInTheDocument();

    store.tasks = store.tasks.map((task) =>
      task.id === "a" ? { ...task, content: "Recovered content" } : task,
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
      expect(within(dialog).getByText("Recovered content")).toBeInTheDocument();
    });
  });

  it("archive scenarios 6–7: only NOT_FOUND dismisses, and a closed sheet stays closed", async () => {
    installClient([
      makeTask({
        id: "a",
        title: "Archived A",
        status: "done",
        completedAt: iso(-2 * DAY),
        archivedAt: iso(-DAY),
      }),
    ]);
    const pending = deferred<Task>();
    getArchivedTask.mockImplementationOnce(() => pending.promise);
    renderPage(ArchivePage);

    fireEvent.click(await screen.findByRole("button", { name: "Open archived task Archived A" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(async () => pending.resolve(requireTask("a")));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openSheet("Archived A");
    await externalWrite(() => {
      store.tasks = store.tasks.map((task) =>
        task.id === "a" ? { ...task, archivedAt: null } : task,
      );
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("archive scenario 7: a late response for A cannot replace a newer selection B", async () => {
    installClient([
      makeTask({
        id: "a",
        title: "Archived A",
        content: "A content",
        status: "done",
        completedAt: iso(-2 * DAY),
        archivedAt: iso(-DAY),
      }),
      makeTask({
        id: "b",
        title: "Archived B",
        content: "B content",
        status: "done",
        completedAt: iso(-3 * DAY),
        archivedAt: iso(-2 * DAY),
      }),
    ]);
    const delayedA = deferred<Task>();
    getArchivedTask.mockImplementation((id: string) =>
      id === "a" ? delayedA.promise : Promise.resolve(requireTask(id)),
    );
    renderPage(ArchivePage);

    fireEvent.click(await screen.findByRole("button", { name: "Open archived task Archived A" }));
    await screen.findByRole("dialog", { name: "Archived task" });
    fireEvent.click(hiddenButton("Open archived task Archived B"));
    const dialog = await screen.findByRole("dialog", { name: "Archived B" });
    expect(within(dialog).getByText("B content")).toBeInTheDocument();

    await act(async () => delayedA.resolve(requireTask("a")));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Archived B" })).toBe(dialog);
      expect(within(dialog).getByText("B content")).toBeInTheDocument();
      expect(within(dialog).queryByText("A content")).not.toBeInTheDocument();
    });
  });

  it("archive scenario 7: closing after an error prevents later refetches from reopening", async () => {
    installClient([
      makeTask({
        id: "a",
        title: "Archived A",
        status: "done",
        completedAt: iso(-2 * DAY),
        archivedAt: iso(-DAY),
      }),
    ]);
    getArchivedTask.mockRejectedValueOnce(new ApiError("NETWORK", "Connection lost"));
    renderPage(ArchivePage);

    fireEvent.click(await screen.findByRole("button", { name: "Open archived task Archived A" }));
    const dialog = await screen.findByRole("dialog", { name: "Archived task" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Connection lost");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await qc.refetchQueries({ queryKey: qk.archivedTask("a") });
    await qc.invalidateQueries({ queryKey: ["archive"] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("archive scenario 6: restore failures retain the selected sheet; success dismisses it", async () => {
    installClient([
      makeTask({
        id: "a",
        title: "Archived A",
        status: "done",
        completedAt: iso(-2 * DAY),
        archivedAt: iso(-DAY),
      }),
    ]);
    renderPage(ArchivePage);
    const dialog = await openSheet("Archived A");
    expect(await screen.findByRole("dialog", { name: "Archived A" })).toBe(dialog);

    restoreTask.mockRejectedValueOnce(new ApiError("NETWORK", "Restore failed"));
    fireEvent.click(screen.getByText("Restore", { selector: "button" }));
    await waitFor(() => expect(restoreTask).toHaveBeenCalledWith("a"));
    expect(screen.getByRole("dialog", { name: "Archived A" })).toBe(dialog);
    expect(requireTask("a").archivedAt).not.toBeNull();

    fireEvent.click(screen.getByText("Restore", { selector: "button" }));
    await waitFor(() => expect(restoreTask).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(requireTask("a").archivedAt).toBeNull();
  });

  it("archive scenario 6: permanent-delete failures retain the selected sheet; success dismisses it", async () => {
    installClient([
      makeTask({
        id: "a",
        title: "Archived A",
        status: "done",
        completedAt: iso(-2 * DAY),
        archivedAt: iso(-DAY),
      }),
    ]);
    renderPage(ArchivePage);
    const dialog = await openSheet("Archived A");
    expect(await screen.findByRole("dialog", { name: "Archived A" })).toBe(dialog);

    permanentlyDeleteTask.mockRejectedValueOnce(new ApiError("NETWORK", "Delete failed"));
    fireEvent.click(hiddenButton("Delete Archived A permanently"));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() => expect(permanentlyDeleteTask).toHaveBeenCalledWith("a"));
    expect(screen.getByRole("dialog", { name: "Archived A" })).toBe(dialog);
    expect(requireTask("a")).toBeDefined();

    fireEvent.click(hiddenButton("Delete Archived A permanently"));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    await waitFor(() => expect(permanentlyDeleteTask).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(store.tasks.find((task) => task.id === "a")).toBeUndefined();
  });
});
