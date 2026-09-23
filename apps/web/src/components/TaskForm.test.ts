import { describe, expect, it } from "vitest";
import { dirtyDraftPatch, draftToValues, type TaskFormValues } from "@/components/TaskForm";

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
