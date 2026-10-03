import { describe, expect, it } from "vitest";
import type { paths } from "@/shared/api/schema.gen";
import type { AppSettings, TaskDraft, TaskUrl } from "@/types";
import {
  archiveListToDomain,
  archiveQueryToWire,
  chatActionToDomain,
  chatMessageToDomain,
  conversationToDomain,
  taskDraftToDomain,
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

type WireSettings =
  paths["/api/v1/settings"]["get"]["responses"][200]["content"]["application/json"];
type WireArchiveList =
  paths["/api/v1/archive"]["get"]["responses"][200]["content"]["application/json"];

/** The exact 14 §5 domain `Task` keys, sorted — used to assert no leak and no drop. */
const TASK_DOMAIN_KEYS = [
  "archivedAt",
  "category",
  "completedAt",
  "content",
  "createdAt",
  "deadlineAt",
  "id",
  "markdownNote",
  "position",
  "priority",
  "status",
  "title",
  "updatedAt",
  "urls",
].sort();

/** `TaskCreate`'s declared keys (schema.gen.ts), sorted. */
const TASK_CREATE_KEYS = [
  "category",
  "content",
  "deadline_at",
  "markdown_note",
  "priority",
  "status",
  "title",
  "urls",
].sort();

/** `TaskUpdate`'s declared keys (schema.gen.ts), sorted. */
const TASK_UPDATE_KEYS = [
  "category",
  "content",
  "deadline_at",
  "markdown_note",
  "priority",
  "status",
  "title",
  "urls",
].sort();

/** `SettingsUpdate`'s declared keys (schema.gen.ts), sorted. */
const SETTINGS_UPDATE_KEYS = ["model_name", "timezone"].sort();

function sortedKeys(obj: object): string[] {
  return Object.keys(obj).sort();
}

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
  it("maps a fully populated TaskResponse to exactly the 14-field domain Task", () => {
    const wire = wireTask({
      completed_at: "2026-09-03T00:00:00+00:00",
      archived_at: "2026-09-04T00:00:00+00:00",
    });

    const domain = taskToDomain(wire);

    expect(domain).toStrictEqual({
      id: "task-1",
      title: "Write the mapper",
      content: "Convert wire fields to camelCase.",
      category: "work",
      priority: "high",
      status: "todo",
      deadlineAt: "2026-10-01T09:00:00+00:00",
      urls: [
        { id: "task-1:url:0", url: "https://example.com/a", label: "A" },
        { id: "task-1:url:1", url: "https://example.com/b" },
      ],
      markdownNote: "some **notes**",
      position: 0,
      createdAt: "2026-09-01T00:00:00+00:00",
      updatedAt: "2026-09-02T00:00:00+00:00",
      completedAt: "2026-09-03T00:00:00+00:00",
      archivedAt: "2026-09-04T00:00:00+00:00",
    });
    expect(sortedKeys(domain)).toStrictEqual(TASK_DOMAIN_KEYS);
  });

  it("assigns stable, deterministic url ids across repeated fetches of the same task", () => {
    const first = taskToDomain(wireTask());
    const second = taskToDomain(wireTask());

    expect(first.urls.map((u) => u.id)).toEqual(second.urls.map((u) => u.id));
    expect(first.urls[0]!.id).toBe("task-1:url:0");
    expect(first.urls[1]!.id).toBe("task-1:url:1");
  });

  it("maps a null label to an absent key, not undefined or null", () => {
    const domain = taskToDomain(wireTask());

    expect(domain.urls[0]!.label).toBe("A");
    expect(domain.urls[1]!.label).toBeUndefined();
    expect("label" in domain.urls[1]!).toBe(false);
  });

  it("keeps a null deadline as an explicit null key, not omitted", () => {
    const domain = taskToDomain(wireTask({ deadline_at: null }));

    expect(domain.deadlineAt).toBeNull();
    expect("deadlineAt" in domain).toBe(true);
  });

  it("maps an empty url list to an empty array, not omitted", () => {
    const domain = taskToDomain(wireTask({ urls: [] }));

    expect(domain.urls).toStrictEqual([]);
  });

  it("maps an empty markdown note to an empty string, not omitted", () => {
    const domain = taskToDomain(wireTask({ markdown_note: "" }));

    expect(domain.markdownNote).toBe("");
  });

  it("round trips every editable field back to the original wire values", () => {
    const wire = wireTask();
    const domain = taskToDomain(wire);

    const patch = taskPatchToWire({
      title: domain.title,
      content: domain.content,
      category: domain.category,
      priority: domain.priority,
      status: domain.status,
      deadlineAt: domain.deadlineAt,
      markdownNote: domain.markdownNote,
      urls: domain.urls,
    });

    expect(patch.title).toBe(wire.title);
    expect(patch.content).toBe(wire.content);
    expect(patch.category).toBe(wire.category);
    expect(patch.priority).toBe(wire.priority);
    expect(patch.status).toBe(wire.status);
    expect(patch.deadline_at).toBe(wire.deadline_at);
    expect(patch.markdown_note).toBe(wire.markdown_note);
    expect(patch.urls).toStrictEqual(
      wire.urls.map((u) => ({ url: u.url, ...(u.label != null ? { label: u.label } : {}) })),
    );
    for (const u of patch.urls!) expect(u).not.toHaveProperty("id");
  });

  it("drops an unrecognized wire field on the task, not passing it through under either name", () => {
    const wire = { ...wireTask(), future_field: "surprise" } as WireTask;

    const domain = taskToDomain(wire);

    expect(domain).not.toHaveProperty("future_field");
    expect(domain).not.toHaveProperty("futureField");
    expect(sortedKeys(domain)).toStrictEqual(TASK_DOMAIN_KEYS);
  });

  it("drops an unrecognized wire field on a nested TaskUrl", () => {
    const wire = wireTask({
      urls: [{ url: "https://example.com/a", label: "A", future_field: "surprise" } as never],
    });

    const domain = taskToDomain(wire);

    expect(domain.urls[0]).not.toHaveProperty("future_field");
    expect(domain.urls[0]).not.toHaveProperty("futureField");
    expect(sortedKeys(domain.urls[0]!)).toStrictEqual(["id", "label", "url"].sort());
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

  it("sends an explicit null deadline, not an omitted key", () => {
    const wire = taskDraftToWire({ ...draft, deadlineAt: null });

    expect(wire.deadline_at).toBeNull();
    expect("deadline_at" in wire).toBe(true);
  });

  it("sends an empty url list as [], not omitted or null", () => {
    const wire = taskDraftToWire({ ...draft, urls: [] });

    expect(wire.urls).toStrictEqual([]);
  });

  it("sends an empty markdown note as '', not omitted or null", () => {
    const wire = taskDraftToWire({ ...draft, markdownNote: "" });

    expect(wire.markdown_note).toBe("");
  });

  it("drops a stray property on the draft, keeping exactly TaskCreate's keys", () => {
    const strayDraft = { ...draft, futureField: "surprise" } as TaskDraft;

    const wire = taskDraftToWire(strayDraft);

    expect(wire).not.toHaveProperty("futureField");
    expect(wire).not.toHaveProperty("future_field");
    expect(sortedKeys(wire)).toStrictEqual(TASK_CREATE_KEYS);
  });

  it("maps only the provided fields of a partial update", () => {
    expect(taskPatchToWire({ title: "Renamed" })).toEqual({ title: "Renamed" });
    expect(taskPatchToWire({ status: "done" })).toEqual({ status: "done" });
    expect(taskPatchToWire({ deadlineAt: null })).toEqual({ deadline_at: null });
    expect(taskPatchToWire({})).toEqual({});
  });

  it("keeps an explicit null deadline in a patch, not an omitted key", () => {
    const wire = taskPatchToWire({ deadlineAt: null });

    expect(wire.deadline_at).toBeNull();
    expect("deadline_at" in wire).toBe(true);
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

  it("drops a stray property on a full patch, keeping exactly TaskUpdate's keys", () => {
    const strayPatch = {
      title: "T",
      content: "C",
      category: "study",
      priority: "low",
      status: "in_progress",
      markdownNote: "note",
      deadlineAt: "2026-10-01T00:00:00+00:00",
      urls: [{ id: "x", url: "https://a.b" }],
      futureField: "surprise",
    } as Parameters<typeof taskPatchToWire>[0];

    const wire = taskPatchToWire(strayPatch);

    expect(wire).not.toHaveProperty("futureField");
    expect(wire).not.toHaveProperty("future_field");
    expect(sortedKeys(wire)).toStrictEqual(TASK_UPDATE_KEYS);
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
  it("maps SettingsResponse to exactly timezone, modelName and availableModels", () => {
    const wire: WireSettings = {
      timezone: "Asia/Singapore",
      model_name: "kimi-k3",
      available_models: ["kimi-k3", "kimi-k3-thinking"],
    };

    expect(settingsToDomain(wire)).toStrictEqual({
      timezone: "Asia/Singapore",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3", "kimi-k3-thinking"],
    });
  });

  it("drops an unrecognized field on SettingsResponse", () => {
    const wire = {
      timezone: "Asia/Singapore",
      model_name: "kimi-k3",
      available_models: ["kimi-k3"],
      future_field: "surprise",
    } as WireSettings;

    const settings = settingsToDomain(wire);

    expect(settings).not.toHaveProperty("future_field");
    expect(settings).not.toHaveProperty("futureField");
    expect(sortedKeys(settings)).toStrictEqual(["availableModels", "modelName", "timezone"].sort());
  });

  it("never sends available_models, even when the patch carries availableModels", () => {
    const wire = settingsPatchToWire({
      timezone: "UTC",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3", "kimi-k3-thinking"],
    });

    expect(wire).not.toHaveProperty("available_models");
    expect(sortedKeys(wire)).toStrictEqual(SETTINGS_UPDATE_KEYS);
  });

  it("maps only the provided settings fields to a partial update", () => {
    expect(settingsPatchToWire({ timezone: "UTC" })).toEqual({ timezone: "UTC" });
    expect(settingsPatchToWire({ modelName: "kimi-k3" })).toEqual({ model_name: "kimi-k3" });
    expect(settingsPatchToWire({})).toEqual({});
  });

  it("drops a stray property on a settings patch, keeping exactly SettingsUpdate's keys", () => {
    const strayPatch = {
      timezone: "UTC",
      modelName: "kimi-k3",
      futureField: "surprise",
    } as Partial<AppSettings>;

    const wire = settingsPatchToWire(strayPatch);

    expect(wire).not.toHaveProperty("futureField");
    expect(wire).not.toHaveProperty("future_field");
    expect(sortedKeys(wire)).toStrictEqual(SETTINGS_UPDATE_KEYS);
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
    expect(sortedKeys(domain)).toStrictEqual(["items", "page", "pageSize", "total"].sort());
  });

  it("drops an unrecognized field at the top level and inside items", () => {
    const wire = {
      items: [{ ...wireTask(), future_field: "surprise" }],
      page: 1,
      page_size: 10,
      total: 1,
      future_field: "surprise",
    } as unknown as WireArchiveList;

    const domain = archiveListToDomain(wire);

    expect(domain).not.toHaveProperty("future_field");
    expect(domain).not.toHaveProperty("futureField");
    expect(sortedKeys(domain)).toStrictEqual(["items", "page", "pageSize", "total"].sort());
    expect(domain.items[0]).not.toHaveProperty("future_field");
    expect(domain.items[0]).not.toHaveProperty("futureField");
    expect(sortedKeys(domain.items[0]!)).toStrictEqual(TASK_DOMAIN_KEYS);
  });

  it("omits an empty search from the query, and always sends a fixed page_size", () => {
    expect(archiveQueryToWire("", 1)).toEqual({ page: 1, page_size: 10 });
    expect(archiveQueryToWire("  ", 3)).toEqual({ page: 3, page_size: 10 });
    expect(archiveQueryToWire("urgent", 2)).toEqual({ search: "urgent", page: 2, page_size: 10 });
  });
});

describe("taskDraftToDomain", () => {
  const minimal = { title: "T", content: "C", category: "work", priority: "low" } as const;

  it("maps a fully populated wire draft to exactly the seven domain keys", () => {
    const result = taskDraftToDomain({
      title: "T",
      content: "C",
      category: "personal",
      priority: "high",
      deadline_at: "2026-10-02T08:00:00Z",
      urls: [
        { url: "https://a.example", label: "A" },
        { url: "https://b.example", label: null },
      ],
      markdown_note: "# note",
    });

    expect(Object.keys(result).sort()).toEqual([
      "category",
      "content",
      "deadlineAt",
      "markdownNote",
      "priority",
      "title",
      "urls",
    ]);
    expect(result).toStrictEqual({
      title: "T",
      content: "C",
      category: "personal",
      priority: "high",
      deadlineAt: "2026-10-02T08:00:00Z",
      urls: [
        { id: expect.any(String), url: "https://a.example", label: "A" },
        { id: expect.any(String), url: "https://b.example" },
      ],
      markdownNote: "# note",
    });
    const ids = result.urls.map((u) => u.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Scenario: minimal wire draft gets domain defaults", () => {
    const result = taskDraftToDomain({ ...minimal, markdown_note: undefined } as never);
    expect(result.deadlineAt).toBeNull();
    expect(result.urls).toEqual([]);
    expect(result.markdownNote).toBe("");
  });

  it("maps a null deadline_at to null", () => {
    expect(
      taskDraftToDomain({ ...minimal, markdown_note: "", deadline_at: null }).deadlineAt,
    ).toBeNull();
  });

  it("drops unknown top-level and URL fields instead of throwing or passing them through", () => {
    const wire = {
      ...minimal,
      markdown_note: "",
      status: "done",
      extra: 1,
      urls: [{ url: "https://a.example", label: null, tracking: "x" }],
    } as never;

    const result = taskDraftToDomain(wire);

    expect(Object.keys(result)).not.toContain("extra");
    expect(Object.keys(result)).not.toContain("status");
    expect(result.urls).toStrictEqual([{ id: expect.any(String), url: "https://a.example" }]);
  });
});

type WireConversation =
  paths["/api/v1/chat/conversation"]["get"]["responses"][200]["content"]["application/json"];
type WireChatMessage = WireConversation["messages"][number];
type WireChatAction = NonNullable<WireChatMessage["action"]>;

const wireDraft = {
  title: "T",
  content: "C",
  category: "work",
  priority: "high",
  deadline_at: null,
  urls: [{ url: "https://a.example", label: "A", extra: "x" }],
  markdown_note: "# n",
  extra: "x",
};
const domainDraft = {
  title: "T",
  content: "C",
  category: "work",
  priority: "high",
  deadlineAt: null,
  urls: [{ id: expect.any(String), url: "https://a.example", label: "A" }],
  markdownNote: "# n",
};

function wireAction(kind: WireChatAction["kind"], payload: Record<string, unknown>) {
  return {
    id: "a1",
    kind,
    title: "Title",
    summary: "Summary",
    fields: [{ label: "L", from: "F", to: "T", extra: "x" }],
    status: "pending",
    payload,
    extra: "x",
  } as unknown as WireChatAction;
}

describe("http/mappers chat", () => {
  it.each([
    ["create", { draft: wireDraft, task_id: "leak", status: "done" }, { draft: domainDraft }],
    [
      "update",
      { task_id: "t1", draft: wireDraft, status: "done" },
      { taskId: "t1", draft: domainDraft },
    ],
    ["move", { task_id: "t1", status: "done", draft: wireDraft }, { taskId: "t1", status: "done" }],
    [
      "schedule",
      { task_id: "t1", deadline_at: "2026-10-02T08:00:00Z", status: "done" },
      { taskId: "t1", deadlineAt: "2026-10-02T08:00:00Z" },
    ],
    ["schedule", { task_id: "t1", deadline_at: null }, { taskId: "t1", deadlineAt: null }],
  ] as const)("narrows a %s payload to its kind's shape", (kind, payload, expected) => {
    const action = chatActionToDomain(wireAction(kind, { ...payload }));
    expect(action.payload).toStrictEqual(expected);
    expect(Object.keys(action.payload).sort()).toEqual(Object.keys(expected).sort());
  });

  it("maps an action to exactly the seven domain keys, dropping unknown fields", () => {
    const action = chatActionToDomain(wireAction("move", { task_id: "t1", status: "done" }));
    expect(Object.keys(action).sort()).toEqual(
      ["fields", "id", "kind", "payload", "status", "summary", "title"].sort(),
    );
    expect(action).toStrictEqual({
      id: "a1",
      kind: "move",
      title: "Title",
      summary: "Summary",
      fields: [{ label: "L", from: "F", to: "T" }],
      status: "pending",
      payload: { taskId: "t1", status: "done" },
    });
  });

  it.each([[null], [undefined]])("maps a %s field `from` to no `from` key", (from) => {
    const wire = wireAction("move", { task_id: "t1", status: "done" });
    wire.fields = [{ label: "L", from, to: "T" }] as unknown as typeof wire.fields;
    const [field] = chatActionToDomain(wire).fields;
    expect(field).toStrictEqual({ label: "L", to: "T" });
    expect("from" in field!).toBe(false);
  });

  it.each([[null], [undefined]])("maps a %s message action to no `action` key", (action) => {
    const message = chatMessageToDomain({
      id: "m1",
      role: "user",
      text: "hi",
      created_at: "2026-09-28T10:00:00Z",
      action,
    } as unknown as WireChatMessage);
    expect(message).toStrictEqual({
      id: "m1",
      role: "user",
      text: "hi",
      createdAt: "2026-09-28T10:00:00Z",
    });
    expect("action" in message).toBe(false);
  });

  it("maps a conversation to exactly {id, messages}, dropping unknown fields at every level", () => {
    const wire = {
      id: "c1",
      extra: "x",
      messages: [
        {
          id: "m1",
          role: "assistant",
          text: "hi",
          created_at: "2026-09-28T10:00:00Z",
          extra: "x",
          action: wireAction("create", { draft: wireDraft }),
        },
      ],
    } as unknown as WireConversation;
    const result = conversationToDomain(wire);
    expect(Object.keys(result).sort()).toEqual(["id", "messages"]);
    expect(Object.keys(result.messages[0]!).sort()).toEqual(
      ["action", "createdAt", "id", "role", "text"].sort(),
    );
    expect(result.messages[0]!.action!.payload).toStrictEqual({ draft: domainDraft });
    expect(result.messages[0]!.action!.fields[0]).toStrictEqual({
      label: "L",
      from: "F",
      to: "T",
    });
  });

  it("defaults an absent urls and markdown_note in a payload draft", () => {
    const action = chatActionToDomain(
      wireAction("create", {
        draft: { title: "T", content: "C", category: "work", priority: "low" },
      }),
    );
    expect(action.payload.draft).toStrictEqual({
      title: "T",
      content: "C",
      category: "work",
      priority: "low",
      deadlineAt: null,
      urls: [],
      markdownNote: "",
    });
  });
});
