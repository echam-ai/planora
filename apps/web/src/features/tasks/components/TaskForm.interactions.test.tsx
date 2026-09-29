import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { format } from "date-fns";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskForm } from "@/features/tasks/components/TaskForm";
import { api } from "@/services/api";

const draft = {
  title: "",
  content: "",
  category: "work" as const,
  priority: "medium" as const,
  deadlineAt: null,
  urls: [],
  markdownNote: "",
};

const settings = {
  timezone: "Asia/Singapore",
  modelName: "kimi-k3",
  availableModels: ["kimi-k3"],
};

function renderForm(props: Partial<ComponentProps<typeof TaskForm>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <TaskForm
        submitLabel="Create task"
        defaultDraft={draft}
        onSubmit={onSubmit}
        onCancel={onCancel}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onSubmit, onCancel };
}

async function pick(trigger: HTMLElement, optionName: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const option = within(await screen.findByRole("listbox")).getByRole("option", {
    name: optionName,
  });
  fireEvent.pointerUp(option, { pointerType: "mouse" });
  fireEvent.click(option);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskForm interactions", () => {
  it("submits the picked category and priority", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue(settings);
    const { onSubmit } = renderForm();

    fireEvent.change(await screen.findByLabelText("Title"), { target: { value: "Revise" } });
    fireEvent.change(screen.getByLabelText("Content"), { target: { value: "Chapter 3" } });
    await pick(screen.getByRole("combobox", { name: "Category" }), "Study");
    await pick(screen.getByRole("combobox", { name: "Priority" }), "High");
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const [submitted, patch] = onSubmit.mock.calls[0]!;
    expect(submitted).toMatchObject({ category: "study", priority: "high" });
    expect(patch).toHaveProperty("category", "study");
    expect(patch).toHaveProperty("priority", "high");
  });

  it("picks a deadline day from the calendar, restores focus, and converts in the Settings timezone", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue(settings);
    const { onSubmit } = renderForm({
      defaultDraft: { ...draft, title: "Revise", content: "Chapter 3" },
    });

    const trigger = await screen.findByRole("button", { name: /Date/ });
    fireEvent.click(trigger);
    const grid = await screen.findByRole("grid");
    await waitFor(() => {
      const active = document.activeElement as HTMLElement;
      expect(grid).toContainElement(active);
      expect(active.tagName).toBe("BUTTON");
    });

    const day = within(grid).getByRole("button", { name: /\b15(st|nd|rd|th)?\b/ });
    fireEvent.click(day);

    await waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
    const expectedDate = new Date(new Date().getFullYear(), new Date().getMonth(), 15);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveTextContent(format(expectedDate, "d MMM yyyy"));

    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const [submitted] = onSubmit.mock.calls[0]!;
    const ymd = format(expectedDate, "yyyy-MM-dd");
    expect(submitted.deadlineAt).toBe(`${ymd}T09:00:00.000Z`);
  });

  it("reports a status change to the handler", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue(settings);
    const onStatusChange = vi.fn();
    renderForm({ status: "todo", onStatusChange });

    await pick(await screen.findByRole("combobox", { name: "Status" }), "In Progress");
    expect(onStatusChange).toHaveBeenCalledWith("in_progress");
  });

  it("shows no Status field when no handler is passed", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue(settings);
    renderForm({ status: "todo" });

    await screen.findByLabelText("Time");
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
  });

  it("calls onCancel once from the loaded state", async () => {
    vi.spyOn(api, "getSettings").mockResolvedValue(settings);
    const { onCancel, onSubmit } = renderForm();

    await screen.findByLabelText("Time");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onCancel once from the timezone error state", async () => {
    vi.spyOn(api, "getSettings").mockRejectedValue(new Error("network down"));
    const { onCancel, onSubmit } = renderForm();

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onCancel once from the timezone loading state", async () => {
    vi.spyOn(api, "getSettings").mockImplementation(() => new Promise(() => {}));
    const { onCancel } = renderForm();

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
