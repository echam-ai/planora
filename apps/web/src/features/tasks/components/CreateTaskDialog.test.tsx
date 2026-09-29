import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateTaskDialog } from "@/features/tasks/components/CreateTaskDialog";
import { api } from "@/services/api";
import type { Task, TaskDraft } from "@/types";

function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
  return {
    title: "Ship the release notes",
    content: "Draft and send the release notes",
    category: "work",
    priority: "medium",
    deadlineAt: null,
    urls: [],
    markdownNote: "",
    ...overrides,
  };
}

function makeTask(): Task {
  return {
    id: "t1",
    title: "Ship the release notes",
    content: "Draft and send the release notes",
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
  };
}

let qc: QueryClient;

function renderDialog(onOpenChange = vi.fn()) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <CreateTaskDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange };
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

describe("CreateTaskDialog", () => {
  it("parses quick-capture text, then creates the reviewed draft and closes", async () => {
    vi.spyOn(api, "parseTaskText").mockResolvedValue(draft());
    const createTask = vi.spyOn(api, "createTask").mockResolvedValue(makeTask());
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "Ship the release notes by Friday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));

    await screen.findByText(/nothing is created until you choose/);
    expect(await screen.findByLabelText("Title")).toHaveValue("Ship the release notes");

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledWith(draft()));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows a parse error with an escape hatch into the full form", async () => {
    vi.spyOn(api, "parseTaskText").mockRejectedValue(new Error("Couldn't understand that text"));
    renderDialog();

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "gibberish" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));

    expect(await screen.findByText("Couldn't understand that text")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue in the form instead" }));

    expect(await screen.findByRole("tab", { name: "Task form", selected: true })).toBeVisible();
  });

  it("returns from the review step back to the quick-capture text", async () => {
    vi.spyOn(api, "parseTaskText").mockResolvedValue(draft());
    renderDialog();

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "Ship the release notes by Friday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));
    await screen.findByRole("button", { name: "Back to text" });

    fireEvent.click(screen.getByRole("button", { name: "Back to text" }));

    expect(await screen.findByLabelText("Describe the task in your own words")).toHaveValue(
      "Ship the release notes by Friday",
    );
  });

  it("creates a task from the full form tab, seeded with the quick-capture text as content", async () => {
    const createTask = vi.spyOn(api, "createTask").mockResolvedValue(makeTask());
    renderDialog();

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "loose notes" },
    });
    // Radix Tabs selects a trigger on pointerdown, not click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Task form" }));

    expect(await screen.findByLabelText("Content")).toHaveValue("loose notes");
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Follow up on loose notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Follow up on loose notes", content: "loose notes" }),
      ),
    );
  });

  it("surfaces the create failure as a toast without dismissing the dialog", async () => {
    vi.spyOn(api, "parseTaskText").mockResolvedValue(draft());
    const createTask = vi
      .spyOn(api, "createTask")
      .mockRejectedValue(new Error("Couldn't save that task"));
    const { onOpenChange } = renderDialog();

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "Ship the release notes by Friday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse task" }));
    await screen.findByRole("button", { name: "Create task" });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closing via Escape reports back through onOpenChange", async () => {
    const { onOpenChange } = renderDialog();

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("cancelling clears the draft, so reopening starts from a blank quick-capture tab", async () => {
    vi.spyOn(api, "parseTaskText").mockResolvedValue(draft());

    function Wrapper() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>reopen</button>
          <CreateTaskDialog open={open} onOpenChange={setOpen} />
        </>
      );
    }
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Wrapper />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Describe the task in your own words"), {
      target: { value: "Ship the release notes by Friday" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    await waitFor(() => {
      expect(screen.getByLabelText("Describe the task in your own words")).toHaveValue("");
    });
  });
});
