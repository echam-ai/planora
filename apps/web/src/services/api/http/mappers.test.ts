import { describe, expect, it } from "vitest";
import type { paths } from "@/shared/api/schema.gen";
import type { TaskDraft, TaskUrl } from "@/types";
import {
  archiveListToDomain,
  archiveQueryToWire,
  passwordChangeToWire,
  sessionToDomain,
  settingsPatchToWire,
  settingsToDomain,
  taskDraftToWire,
  taskMoveToWire,
  taskPatchToWire,
  taskReorderToWire,
  taskToDomain,
} from "./mappers";

type WireTask =
  paths["/api/v1/tasks/{task_id}"]["get"]["responses"][200]["content"]["application/json"];

function wireTask(overrides: Partial<WireTask> = {}): WireTask {
  return {
    id: "task-1",
    title: "Write the mapper",
    content: "Convert wire fields to camelCase.",
    category: "work",
    priority: "high",
    status: "todo",
    deadline_at: "2026-10-01T09:00:00+00:00",
    urls: [
      { url: "https://example.com/a", label: "A" },
      { url: "https://example.com/b", label: null },
    ],
    markdown_note: "some **notes**",
    position: 0,
    created_at: "2026-09-01T00:00:00+00:00",
    updated_at: "2026-09-02T00:00:00+00:00",
    completed_at: null,
    archived_at: null,
    ...overrides,
  };
}

describe("http/mappers taskToDomain", () => {
  it("maps all 14 §5 fields to camelCase", () => {
    const domain = taskToDomain(wireTask());

    expect(domain).toMatchObject({
      id: "task-1",
      title: "Write the mapper",
      content: "Convert wire fields to camelCase.",
      category: "work",
      priority: "high",
      status: "todo",
      deadlineAt: "2026-10-01T09:00:00+00:00",
      markdownNote: "some **notes**",
      position: 0,
      createdAt: "2026-09-01T00:00:00+00:00",
      updatedAt: "2026-09-02T00:00:00+00:00",
      completedAt: null,
      archivedAt: null,
    });
    expect(domain.urls).toHaveLength(2);
  });

  it("assigns stable, deterministic url ids across repeated fetches of the same task", () => {
    const first = taskToDomain(wireTask());
    const second = taskToDomain(wireTask());

    expect(first.urls.map((u) => u.id)).toEqual(second.urls.map((u) => u.id));
    expect(first.urls[0]!.id).toBe("task-1:url:0");
    expect(first.urls[1]!.id).toBe("task-1:url:1");
  });

  it("maps a null label to undefined", () => {
    const domain = taskToDomain(wireTask());

    expect(domain.urls[0]!.label).toBe("A");
    expect(domain.urls[1]!.label).toBeUndefined();
    expect("label" in domain.urls[1]!).toBe(false);
  });
});

describe("http/mappers task out", () => {
  const draft: TaskDraft = {
    title: "New task",
    content: "Body",
    category: "personal",
    priority: "medium",
    deadlineAt: null,
    markdownNote: "",
    urls: [{ id: "local-1", url: "https://example.com", label: "Docs" }],
  };

  it("maps a TaskDraft to TaskCreate, dropping url ids and starting in todo", () => {
    const wire = taskDraftToWire(draft);

    expect(wire).toEqual({
      title: "New task",
      content: "Body",
      category: "personal",
      priority: "medium",
      status: "todo",
      deadline_at: null,
      markdown_note: "",
      urls: [{ url: "https://example.com", label: "Docs" }],
    });
    expect(wire.urls![0]).not.toHaveProperty("id");
  });

  it("omits an undefined label rather than sending null", () => {
    const url: TaskUrl = { id: "local-2", url: "https://example.com" };
    const wire = taskDraftToWire({ ...draft, urls: [url] });

    expect(wire.urls![0]).toEqual({ url: "https://example.com" });
    expect(wire.urls![0]).not.toHaveProperty("label");
  });

  it("maps only the provided fields of a partial update", () => {
    expect(taskPatchToWire({ title: "Renamed" })).toEqual({ title: "Renamed" });
    expect(taskPatchToWire({ status: "done" })).toEqual({ status: "done" });
    expect(taskPatchToWire({ deadlineAt: null })).toEqual({ deadline_at: null });
    expect(taskPatchToWire({})).toEqual({});
  });

  it("maps a full partial update across every field", () => {
    const wire = taskPatchToWire({
      title: "T",
      content: "C",
      category: "study",
      priority: "low",
      status: "in_progress",
      markdownNote: "note",
      deadlineAt: "2026-10-01T00:00:00+00:00",
      urls: [{ id: "x", url: "https://a.b" }],
    });

    expect(wire).toEqual({
      title: "T",
      content: "C",
      category: "study",
      priority: "low",
      status: "in_progress",
      markdown_note: "note",
      deadline_at: "2026-10-01T00:00:00+00:00",
      urls: [{ url: "https://a.b" }],
    });
  });
});

describe("http/mappers moves and reorders", () => {
  it("maps a move to {status, index}", () => {
    expect(taskMoveToWire("done", 2)).toEqual({ status: "done", index: 2 });
  });

  it("maps a reorder to {status, ordered_ids}", () => {
    expect(taskReorderToWire("todo", ["a", "b"])).toEqual({
      status: "todo",
      ordered_ids: ["a", "b"],
    });
  });
});

describe("http/mappers session and settings", () => {
  it("maps SessionResponse to camelCase", () => {
    expect(
      sessionToDomain({ username: "demo", signed_in_at: "2026-09-28T10:00:00+00:00" }),
    ).toEqual({
      username: "demo",
      signedInAt: "2026-09-28T10:00:00+00:00",
    });
  });

  it("maps SettingsResponse to camelCase", () => {
    expect(settingsToDomain({ timezone: "Asia/Singapore", model_name: "kimi-k3" })).toEqual({
      timezone: "Asia/Singapore",
      modelName: "kimi-k3",
    });
  });

  it("maps only the provided settings fields to a partial update", () => {
    expect(settingsPatchToWire({ timezone: "UTC" })).toEqual({ timezone: "UTC" });
    expect(settingsPatchToWire({ modelName: "kimi-k3" })).toEqual({ model_name: "kimi-k3" });
    expect(settingsPatchToWire({})).toEqual({});
  });

  it("maps a password change to snake_case", () => {
    expect(passwordChangeToWire("old", "new")).toEqual({
      current_password: "old",
      new_password: "new",
    });
  });
});

describe("http/mappers archive", () => {
  it("maps ArchiveListResponse to camelCase, including its tasks", () => {
    const wire = {
      items: [wireTask()],
      page: 1,
      page_size: 10,
      total: 1,
    };

    const domain = archiveListToDomain(wire);

    expect(domain.page).toBe(1);
    expect(domain.pageSize).toBe(10);
    expect(domain.total).toBe(1);
    expect(domain.items[0]!.id).toBe("task-1");
  });

  it("omits an empty search from the query, and always sends a fixed page_size", () => {
    expect(archiveQueryToWire("", 1)).toEqual({ page: 1, page_size: 10 });
    expect(archiveQueryToWire("  ", 3)).toEqual({ page: 3, page_size: 10 });
    expect(archiveQueryToWire("urgent", 2)).toEqual({ search: "urgent", page: 2, page_size: 10 });
  });
});
