import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  TaskForm,
  dirtyDraftPatch,
  draftToValues,
  type TaskFormValues,
} from "@/components/TaskForm";

const values: TaskFormValues = {
  title: "  Ship it  ",
  content: " Content ",
  category: "personal",
  priority: "high",
  deadlineLocal: "2026-09-25T10:30",
  markdownNote: "note",
  urls: [
    { id: "u1", url: " https://a.example ", label: " Alpha " },
    { id: "u2", url: "https://b.example", label: "" },
  ],
};

describe("dirtyDraftPatch", () => {
  it("returns an empty patch when nothing was edited", () => {
    expect(dirtyDraftPatch(values, {})).toEqual({});
  });

  it("maps each edited field to its draft key", () => {
    expect(dirtyDraftPatch(values, { title: true })).toEqual({ title: "Ship it" });
    expect(dirtyDraftPatch(values, { content: true })).toEqual({ content: "Content" });
    expect(dirtyDraftPatch(values, { category: true })).toEqual({ category: "personal" });
    expect(dirtyDraftPatch(values, { priority: true })).toEqual({ priority: "high" });
    expect(dirtyDraftPatch(values, { markdownNote: true })).toEqual({ markdownNote: "note" });
  });

  it("maps the local deadline field to deadlineAt", () => {
    const patch = dirtyDraftPatch(values, { deadlineLocal: true });
    expect(Object.keys(patch)).toEqual(["deadlineAt"]);
    expect(patch.deadlineAt).toBe(new Date(values.deadlineLocal ?? "").toISOString());
  });

  it("maps a cleared deadline to null", () => {
    const patch = dirtyDraftPatch({ ...values, deadlineLocal: "" }, { deadlineLocal: true });
    expect(patch).toEqual({ deadlineAt: null });
  });

  it("sends the whole link list when any link input was edited", () => {
    const patch = dirtyDraftPatch(values, { urls: [undefined, { label: true }] });
    expect(patch).toEqual({
      urls: [
        { id: "u1", url: "https://a.example", label: "Alpha" },
        { id: "u2", url: "https://b.example", label: undefined },
      ],
    });
  });

  it("ignores empty dirty markers", () => {
    expect(dirtyDraftPatch(values, { urls: [], title: undefined })).toEqual({});
  });

  it("collects every edited field in one patch", () => {
    const patch = dirtyDraftPatch(values, {
      title: true,
      content: true,
      category: true,
      priority: true,
      deadlineLocal: true,
      markdownNote: true,
      urls: [{ url: true }],
    });
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
    const formValues = draftToValues({
      title: "t",
      content: "c",
      category: "work",
      priority: "low",
      deadlineAt: null,
      urls: [{ id: "u1", url: "https://a.example" }],
      markdownNote: "",
    });
    expect(formValues).toEqual({
      title: "t",
      content: "c",
      category: "work",
      priority: "low",
      deadlineLocal: "",
      markdownNote: "",
      urls: [{ id: "u1", url: "https://a.example", label: "" }],
    });
  });
});

describe("TaskForm validation", () => {
  it("blocks whitespace-only required fields with the established messages", async () => {
    const onSubmit = vi.fn();
    render(
      createElement(TaskForm, {
        submitLabel: "Create task",
        onSubmit,
        onCancel: vi.fn(),
        defaultDraft: { ...emptyTaskDraft, title: "   ", content: "   " },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    expect(await screen.findByText("Give the task a title.")).toBeInTheDocument();
    expect(screen.getByText("Describe what needs to happen.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a valid draft with a null deadline and empty Markdown note", async () => {
    const onSubmit = vi.fn();
    render(
      createElement(TaskForm, {
        submitLabel: "Create task",
        onSubmit,
        onCancel: vi.fn(),
        defaultDraft: emptyTaskDraft,
      }),
    );

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Prepare review" } });
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
