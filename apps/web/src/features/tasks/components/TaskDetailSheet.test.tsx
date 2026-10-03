import type { ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskDetailSheet } from "@/features/tasks/components/TaskDetailSheet";
import { api } from "@/services/api";
import type { Task } from "@/types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "a",
    title: "Ship it",
    content: "Original content",
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

function renderSheet(props: Partial<ComponentProps<typeof TaskDetailSheet>> = {}) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <TaskDetailSheet task={makeTask()} timezone="UTC" onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

beforeEach(() => {
  vi.spyOn(api, "getSettings").mockResolvedValue({
    timezone: "UTC",
    modelName: "kimi-k3",
    availableModels: ["kimi-k3"],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  qc?.clear();
});

describe("TaskDetailSheet", () => {
  it("read-only view shows each link by its label, falling back to the URL when unlabelled", () => {
    renderSheet({
      readOnly: true,
      task: makeTask({
        urls: [
          { id: "u1", url: "https://a.example", label: "Alpha docs" },
          { id: "u2", url: "https://b.example" },
        ],
      }),
    });

    expect(screen.getByRole("link", { name: /Alpha docs/ })).toHaveAttribute(
      "href",
      "https://a.example",
    );
    expect(screen.getByRole("link", { name: /https:\/\/b\.example/ })).toBeInTheDocument();
  });

  it("edit view shows an unlabelled link by its URL, above the editable form", () => {
    vi.spyOn(api, "getSettings").mockResolvedValue({
      timezone: "UTC",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    renderSheet({
      task: makeTask({ urls: [{ id: "u1", url: "https://c.example" }] }),
    });

    expect(screen.getByRole("link", { name: /https:\/\/c\.example/ })).toBeInTheDocument();
  });

  it("closing the sheet without saving (Escape) reports back through onClose", async () => {
    const { onClose } = renderSheet();

    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("a failed save keeps the sheet open so the user can retry", async () => {
    const updateTask = vi
      .spyOn(api, "updateTask")
      .mockRejectedValue(new Error("Couldn't save that task"));
    const { onClose } = renderSheet();

    fireEvent.change(await screen.findByLabelText("Title"), {
      target: { value: "Ship it v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a failed delete keeps the sheet open so the user can retry", async () => {
    const deleteTask = vi
      .spyOn(api, "deleteTask")
      .mockRejectedValue(new Error("Couldn't delete that task"));
    const { onClose } = renderSheet();

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete task" }));

    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("a"));
    expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

it("archived detail offers titled irreversible deletion and retries a failure", async () => {
  const purge = vi
    .spyOn(api, "permanentlyDeleteTask")
    .mockRejectedValueOnce(new Error("Try deletion again"))
    .mockResolvedValue(undefined);
  const { onClose } = renderSheet({
    readOnly: true,
    task: makeTask({ archivedAt: new Date().toISOString() }),
  });
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const confirmation = screen.getByRole("alertdialog");
  expect(within(confirmation).getByRole("heading")).toHaveTextContent("Ship it");
  expect(confirmation).toHaveTextContent("cannot be undone");
  fireEvent.click(within(confirmation).getByRole("button", { name: "Delete task" }));
  expect(await within(confirmation).findByRole("alert")).toHaveTextContent("Try deletion again");
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole("button", { name: "Delete task" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(purge).toHaveBeenCalledTimes(2);
});
