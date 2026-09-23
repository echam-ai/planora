import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { qk } from "@/hooks/useApi";
import { api } from "@/services/api";
import type { Conversation, Task, TaskDraft } from "@/types";

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
let qc: QueryClient;

function installClient(seed: Task[]) {
  store = { tasks: seed };
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

  vi.spyOn(api, "getSession").mockResolvedValue({ username: "demo", signedInAt: iso(-HOUR) });
  vi.spyOn(api, "getSettings").mockResolvedValue({ timezone: "UTC", modelName: "kimi-k3" });
  vi.spyOn(api, "listTasks").mockImplementation(async () =>
    store.tasks.filter((t) => !t.archivedAt),
  );
  vi.spyOn(api, "listArchive").mockImplementation(async () => ({
    items: store.tasks.filter((t) => t.archivedAt),
    total: store.tasks.filter((t) => t.archivedAt).length,
    page: 1,
    pageSize: 10,
  }));
  updateTask = vi
    .spyOn(api, "updateTask")
    .mockImplementation(async (id, patch) => applyPatch(id, patch));
  deleteTask = vi.spyOn(api, "deleteTask").mockImplementation(async (id) => {
    store.tasks = store.tasks.filter((t) => t.id !== id);
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
    await screen.findByRole("button", { name: new RegExp(`Open (archived )?task ${title}`) }),
  );
  return screen.findByRole("dialog");
}

function field(scope: HTMLElement, name: string) {
  return within(scope).getByLabelText(name);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
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
    fireEvent.change(field(dialog, "Title"), { target: { value: "Ship it v2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    const [, patch] = updateTask.mock.calls[0] as [string, Record<string, unknown>];
    expect(patch["status"]).toBe("done");
    expect(Object.keys(patch).sort()).toEqual(["status", "title"]);
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
    renderPage(TasksPage);
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
    qc.clear();

    // read-only archive view follows the task too
    renderPage(ArchivePage);
    dialog = await openSheet("Archived task");
    expect(within(dialog).getByText("Archived content")).toBeInTheDocument();
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
    expect(within(dialog).getByText("Completed")).toBeInTheDocument();

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
});
