import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskForm, type TaskFormValues } from "@/features/tasks/components/TaskForm";
import { dirtyDraftPatch, draftToValues } from "@/features/tasks/formMapping";
import { api } from "@/services/api";

const values: TaskFormValues = {
  title: "  Ship it  ",
  content: " Content ",
  category: "personal",
  priority: "high",
  deadlineDate: "2026-09-25",
  deadlineTime: "17:00",
  markdownNote: "note",
  urls: [
    { id: "u1", url: " https://a.example ", label: " Alpha " },
    { id: "u2", url: "https://b.example", label: "" },
  ],
};

describe("dirtyDraftPatch", () => {
  it("returns an empty patch when nothing was edited", () => {
    expect(dirtyDraftPatch(values, {}, "Asia/Singapore")).toEqual({});
  });

  it("maps each edited field to its draft key", () => {
    expect(dirtyDraftPatch(values, { title: true }, "Asia/Singapore")).toEqual({
      title: "Ship it",
    });
    expect(dirtyDraftPatch(values, { content: true }, "Asia/Singapore")).toEqual({
      content: "Content",
    });
    expect(dirtyDraftPatch(values, { category: true }, "Asia/Singapore")).toEqual({
      category: "personal",
    });
    expect(dirtyDraftPatch(values, { priority: true }, "Asia/Singapore")).toEqual({
      priority: "high",
    });
    expect(dirtyDraftPatch(values, { markdownNote: true }, "Asia/Singapore")).toEqual({
      markdownNote: "note",
    });
  });

  it("converts the entered wall-clock deadline with the Settings timezone, not the browser's", () => {
    const sgt = dirtyDraftPatch(values, { deadlineDate: true }, "Asia/Singapore");
    expect(Object.keys(sgt)).toEqual(["deadlineAt"]);
    expect(sgt.deadlineAt).toBe("2026-09-25T09:00:00.000Z");

    const nyc = dirtyDraftPatch(values, { deadlineTime: true }, "America/New_York");
    expect(nyc.deadlineAt).toBe("2026-09-25T21:00:00.000Z");
  });

  it("uses the Settings timezone after it changes, for entry made after the change", () => {
    const patch = dirtyDraftPatch(values, { deadlineDate: true }, "UTC");
    expect(patch.deadlineAt).toBe("2026-09-25T17:00:00.000Z");
  });

  it("honours daylight saving in the Settings timezone", () => {
    const winter = dirtyDraftPatch(
      { ...values, deadlineDate: "2026-01-15", deadlineTime: "17:00" },
      { deadlineDate: true },
      "Europe/London",
    );
    expect(winter.deadlineAt).toBe("2026-01-15T17:00:00.000Z");

    const summer = dirtyDraftPatch(
      { ...values, deadlineDate: "2026-07-15", deadlineTime: "17:00" },
      { deadlineDate: true },
      "Europe/London",
    );
    expect(summer.deadlineAt).toBe("2026-07-15T16:00:00.000Z");
  });

  it("maps a cleared deadline to null", () => {
    const patch = dirtyDraftPatch(
      { ...values, deadlineDate: "", deadlineTime: "" },
      { deadlineDate: true },
      "Asia/Singapore",
    );
    expect(patch).toEqual({ deadlineAt: null });
  });

  it("sends the whole link list when any link input was edited", () => {
    const patch = dirtyDraftPatch(values, { urls: [undefined, { label: true }] }, "Asia/Singapore");
    expect(patch).toEqual({
      urls: [
        { id: "u1", url: "https://a.example", label: "Alpha" },
        { id: "u2", url: "https://b.example", label: undefined },
      ],
    });
  });

  it("ignores empty dirty markers", () => {
    expect(dirtyDraftPatch(values, { urls: [], title: undefined }, "Asia/Singapore")).toEqual({});
  });

  it("collects every edited field in one patch", () => {
    const patch = dirtyDraftPatch(
      values,
      {
        title: true,
        content: true,
        category: true,
        priority: true,
        deadlineDate: true,
        deadlineTime: true,
        markdownNote: true,
        urls: [{ url: true }],
      },
      "Asia/Singapore",
    );
    expect(Object.keys(patch).sort()).toEqual([
      "category",
      "content",
      "deadlineAt",
      "markdownNote",
      "priority",
      "title",
      "urls",
    ]);
  });
});

describe("draftToValues", () => {
  it("fills the form shape without losing data", () => {
    const formValues = draftToValues(
      {
        title: "t",
        content: "c",
        category: "work",
        priority: "low",
        deadlineAt: null,
        urls: [{ id: "u1", url: "https://a.example" }],
        markdownNote: "",
      },
      "Asia/Singapore",
    );
    expect(formValues).toEqual({
      title: "t",
      content: "c",
      category: "work",
      priority: "low",
      deadlineDate: "",
      deadlineTime: "",
      markdownNote: "",
      urls: [{ id: "u1", url: "https://a.example", label: "" }],
    });
  });

  it("prefills the wall-clock date and time in the given timezone, whatever the browser zone", () => {
    const draft = {
      title: "t",
      content: "c",
      category: "work" as const,
      priority: "low" as const,
      deadlineAt: "2026-09-25T09:00:00.000Z",
      urls: [],
      markdownNote: "",
    };
    expect(draftToValues(draft, "Asia/Singapore")).toMatchObject({
      deadlineDate: "2026-09-25",
      deadlineTime: "17:00",
    });
    expect(draftToValues(draft, "UTC")).toMatchObject({
      deadlineDate: "2026-09-25",
      deadlineTime: "09:00",
    });
  });
});

function renderTaskFormRaw(props: ComponentProps<typeof TaskForm>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client: qc }, createElement(TaskForm, props)));
}

function renderTaskForm(props: ComponentProps<typeof TaskForm>) {
  vi.spyOn(api, "getSettings").mockResolvedValue({
    timezone: "Asia/Singapore",
    modelName: "kimi-k3",
    availableModels: ["kimi-k3"],
  });
  return renderTaskFormRaw(props);
}

describe("TaskForm validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks whitespace-only required fields with the established messages", async () => {
    const onSubmit = vi.fn();
    renderTaskForm({
      submitLabel: "Create task",
      onSubmit,
      onCancel: vi.fn(),
      defaultDraft: { ...emptyTaskDraft, title: "   ", content: "   " },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Create task" }));

    expect(await screen.findByText("Give the task a title.")).toBeInTheDocument();
    expect(screen.getByText("Describe what needs to happen.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a valid draft with a null deadline and empty Markdown note", async () => {
    const onSubmit = vi.fn();
    renderTaskForm({
      submitLabel: "Create task",
      onSubmit,
      onCancel: vi.fn(),
      defaultDraft: emptyTaskDraft,
    });

    fireEvent.change(await screen.findByLabelText("Title"), {
      target: { value: "Prepare review" },
    });
    fireEvent.change(screen.getByLabelText("Content"), {
      target: { value: "Write review notes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const [submittedDraft] = onSubmit.mock.calls[0]!;
    expect(submittedDraft).toMatchObject({
      title: "Prepare review",
      content: "Write review notes.",
      deadlineAt: null,
      urls: [],
      markdownNote: "",
    });
  });

  it("blocks a time entered without a date, next to the deadline field, and does not submit", async () => {
    const onSubmit = vi.fn();
    renderTaskForm({
      submitLabel: "Create task",
      onSubmit,
      onCancel: vi.fn(),
      defaultDraft: {
        ...emptyTaskDraft,
        title: "Prepare review",
        content: "Write review notes.",
      },
    });

    fireEvent.change(await screen.findByLabelText("Time"), { target: { value: "17:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    expect(
      await screen.findByText("Enter both a date and a time, or leave both empty."),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows Clear deadline only once a field has a value, and clears both on click", async () => {
    renderTaskForm({
      submitLabel: "Create task",
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      defaultDraft: emptyTaskDraft,
    });

    await screen.findByLabelText("Time");
    expect(screen.queryByRole("button", { name: "Clear deadline" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "17:00" } });

    const clearButton = await screen.findByRole("button", { name: "Clear deadline" });
    fireEvent.click(clearButton);

    expect(screen.getByLabelText("Time")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear deadline" })).not.toBeInTheDocument();
  });

  it("clears an existing deadline through the Clear deadline button and saves deadlineAt: null", async () => {
    const onSubmit = vi.fn();
    renderTaskForm({
      submitLabel: "Save changes",
      onSubmit,
      onCancel: vi.fn(),
      defaultDraft: {
        ...emptyTaskDraft,
        title: "Prepare review",
        content: "Write review notes.",
        deadlineAt: "2026-09-25T09:00:00.000Z",
      },
    });

    const clearButton = await screen.findByRole("button", { name: "Clear deadline" });
    fireEvent.click(clearButton);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const [draft, patch] = onSubmit.mock.calls[0]!;
    expect(draft.deadlineAt).toBeNull();
    expect(patch).toEqual({ deadlineAt: null });
  });

  it("shows a loading state with no deadline fields while settings are loading", async () => {
    vi.spyOn(api, "getSettings").mockImplementation(() => new Promise(() => {}));
    renderTaskFormRaw({
      submitLabel: "Create task",
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      defaultDraft: emptyTaskDraft,
    });

    expect(await screen.findByText("Loading your timezone…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Time")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Date/ })).not.toBeInTheDocument();
  });

  it("shows a recoverable error state with no deadline fields when settings fail to load", async () => {
    const getSettings = vi.spyOn(api, "getSettings").mockRejectedValue(new Error("network down"));
    renderTaskFormRaw({
      submitLabel: "Create task",
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      defaultDraft: emptyTaskDraft,
    });

    expect(
      await screen.findByText(
        "Couldn't load your timezone. Deadlines can't be entered until it loads.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Time")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Date/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    getSettings.mockResolvedValueOnce({
      timezone: "Asia/Singapore",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByLabelText("Time")).toBeInTheDocument();
  });

  it("shows the Settings timezone's IANA name next to the deadline field", async () => {
    renderTaskForm({
      submitLabel: "Create task",
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
      defaultDraft: emptyTaskDraft,
    });

    expect(await screen.findByText("Interpreted in Asia/Singapore")).toBeInTheDocument();
  });

  it("keeps remaining link IDs and values when an added link is removed", async () => {
    const onSubmit = vi.fn();
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
    renderTaskForm({
      submitLabel: "Create task",
      onSubmit,
      onCancel: vi.fn(),
      defaultDraft: {
        ...emptyTaskDraft,
        title: "Prepare review",
        content: "Write review notes.",
        urls: [{ id: "url_existing", url: "https://existing.example", label: "Existing" }],
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Add link" }));
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    const urlInputs = screen.getAllByPlaceholderText("https://…");
    const labelInputs = screen.getAllByPlaceholderText("Label (optional)");
    fireEvent.change(urlInputs[1]!, { target: { value: "https://remove.example" } });
    fireEvent.change(labelInputs[1]!, { target: { value: "Remove" } });
    fireEvent.change(urlInputs[2]!, { target: { value: "https://keep.example" } });
    fireEvent.change(labelInputs[2]!, { target: { value: "Keep" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Remove link" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const [submittedDraft] = onSubmit.mock.calls[0]!;
    expect(submittedDraft.urls).toEqual([
      { id: "url_existing", url: "https://existing.example", label: "Existing" },
      {
        id: `url_${(0.2).toString(36).slice(2, 10)}`,
        url: "https://keep.example",
        label: "Keep",
      },
    ]);
  });
});

const emptyTaskDraft = {
  title: "",
  content: "",
  category: "work" as const,
  priority: "medium" as const,
  deadlineAt: null,
  urls: [],
  markdownNote: "",
};
