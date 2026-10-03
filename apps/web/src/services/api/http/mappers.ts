/**
 * The only snake_case ↔ camelCase converter in the web tier (binding rule 2).
 * Every HTTP endpoint function in `httpApiClient.ts` builds its request body
 * and query string here, and maps every response here — nothing else in
 * `src` should reference a wire field name like `deadline_at`.
 */
import type { paths } from "@/shared/api/schema.gen";
import type { ArchivePage } from "../ApiClient";
import type {
  AppSettings,
  ChatAction,
  ChatActionField,
  ChatActionPayload,
  ChatMessage,
  Conversation,
  ParsedTaskText,
  Task,
  TaskDraft,
  TaskStatus,
  TaskUrl,
} from "@/types";

type WireTask =
  paths["/api/v1/tasks/{task_id}"]["get"]["responses"][200]["content"]["application/json"];
type WireTaskUrl = WireTask["urls"][number];
type WireTaskCreate = paths["/api/v1/tasks"]["post"]["requestBody"]["content"]["application/json"];
type WireTaskUpdate =
  paths["/api/v1/tasks/{task_id}"]["patch"]["requestBody"]["content"]["application/json"];
type WireParsedTask =
  paths["/api/v1/ai/parse-task"]["post"]["responses"][200]["content"]["application/json"];
type WireConversation =
  paths["/api/v1/chat/conversation"]["get"]["responses"][200]["content"]["application/json"];
type WireChatMessage = WireConversation["messages"][number];
type WireChatAction = NonNullable<WireChatMessage["action"]>;
type WireChatField = WireChatAction["fields"][number];
type WireSettings =
  paths["/api/v1/settings"]["get"]["responses"][200]["content"]["application/json"];
type WireSettingsUpdate =
  paths["/api/v1/settings"]["patch"]["requestBody"]["content"]["application/json"];
type WireArchiveList =
  paths["/api/v1/archive"]["get"]["responses"][200]["content"]["application/json"];
type WireTaskMove =
  paths["/api/v1/tasks/{task_id}/move"]["post"]["requestBody"]["content"]["application/json"];
type WireTaskReorder =
  paths["/api/v1/tasks/reorder"]["post"]["requestBody"]["content"]["application/json"];

/** Deterministic, stable across repeated fetches of the same task. */
function urlId(taskId: string, index: number): string {
  return `${taskId}:url:${index}`;
}

export function taskUrlToDomain(wire: WireTaskUrl, taskId: string, index: number): TaskUrl {
  return {
    id: urlId(taskId, index),
    url: wire.url,
    ...(wire.label != null ? { label: wire.label } : {}),
  };
}

export function taskUrlToWire(url: TaskUrl): WireTaskUrl {
  return {
    url: url.url,
    ...(url.label !== undefined ? { label: url.label } : {}),
  };
}

export function taskToDomain(wire: WireTask): Task {
  return {
    id: wire.id,
    title: wire.title,
    content: wire.content,
    category: wire.category,
    priority: wire.priority,
    status: wire.status,
    deadlineAt: wire.deadline_at,
    urls: wire.urls.map((url, index) => taskUrlToDomain(url, wire.id, index)),
    markdownNote: wire.markdown_note,
    position: wire.position,
    createdAt: wire.created_at,
    updatedAt: wire.updated_at,
    completedAt: wire.completed_at,
    archivedAt: wire.archived_at,
  };
}

/**
 * A `TaskDraft` wire object (`ParsedTaskResponse`, spec §6.2) to the domain
 * draft. Also the mapper for any later payload that carries a proposed task,
 * such as chat create/update actions. Applies the domain defaults for omitted
 * optional fields, builds a URL id (the wire `TaskUrl` has none), and copies
 * fields explicitly so unknown ones are dropped (#36).
 */
export function taskDraftToDomain(wire: WireParsedTask): TaskDraft {
  return {
    title: wire.title,
    content: wire.content,
    category: wire.category,
    priority: wire.priority,
    deadlineAt: wire.deadline_at ?? null,
    urls: (wire.urls ?? []).map((url, index) => taskUrlToDomain(url, "draft", index)),
    markdownNote: wire.markdown_note ?? "",
  };
}

/** `createTask` always starts a task in `todo`, matching the mock and the API's own default. */
export function taskDraftToWire(draft: TaskDraft): WireTaskCreate {
  return {
    title: draft.title,
    content: draft.content,
    category: draft.category,
    priority: draft.priority,
    status: "todo",
    deadline_at: draft.deadlineAt,
    markdown_note: draft.markdownNote,
    urls: draft.urls.map(taskUrlToWire),
  };
}

/** Only the fields present on `patch` are included, matching the API's partial-update contract. */
export function taskPatchToWire(
  patch: Partial<TaskDraft> & { status?: TaskStatus },
): WireTaskUpdate {
  const wire: WireTaskUpdate = {};
  if (patch.title !== undefined) wire.title = patch.title;
  if (patch.content !== undefined) wire.content = patch.content;
  if (patch.category !== undefined) wire.category = patch.category;
  if (patch.priority !== undefined) wire.priority = patch.priority;
  if (patch.status !== undefined) wire.status = patch.status;
  if (patch.markdownNote !== undefined) wire.markdown_note = patch.markdownNote;
  if (patch.deadlineAt !== undefined) wire.deadline_at = patch.deadlineAt;
  if (patch.urls !== undefined) wire.urls = patch.urls.map(taskUrlToWire);
  return wire;
}

export function taskMoveToWire(status: TaskStatus, position: number): WireTaskMove {
  return { status, index: position };
}

export function taskReorderToWire(status: TaskStatus, orderedIds: string[]): WireTaskReorder {
  return { status, ordered_ids: orderedIds };
}

export function settingsToDomain(wire: WireSettings): AppSettings {
  return {
    timezone: wire.timezone,
    modelName: wire.model_name,
    availableModels: [...wire.available_models],
  };
}

export function settingsPatchToWire(patch: Partial<AppSettings>): WireSettingsUpdate {
  const wire: WireSettingsUpdate = {};
  if (patch.timezone !== undefined) wire.timezone = patch.timezone;
  if (patch.modelName !== undefined) wire.model_name = patch.modelName;
  return wire;
}

export function archiveListToDomain(wire: WireArchiveList): ArchivePage {
  return {
    items: wire.items.map(taskToDomain),
    total: wire.total,
    page: wire.page,
    pageSize: wire.page_size,
  };
}

/** `page_size` is fixed at 10, matching the mock's page size. An empty `search` is omitted. */
export function archiveQueryToWire(
  search: string,
  page: number,
): { search?: string; page: number; page_size: number } {
  const trimmed = search.trim();
  return { ...(trimmed ? { search: trimmed } : {}), page, page_size: 10 };
}

function chatFieldToDomain(wire: WireChatField): ChatActionField {
  return {
    label: wire.label,
    ...(typeof wire.from === "string" ? { from: wire.from } : {}),
    to: wire.to,
  };
}

/**
 * The wire `payload` is an open object, so it is narrowed by `kind` (create,
 * update, move, schedule) into the `shared/domain/chat.ts` shape. Keys that do
 * not belong to the kind are dropped, and a `null` `deadline_at` stays `null`
 * (it removes the deadline).
 */
function chatPayloadToDomain(
  kind: WireChatAction["kind"],
  payload: WireChatAction["payload"],
): ChatActionPayload {
  const { task_id, draft, status, deadline_at } = payload;
  const taskId = task_id as string;
  switch (kind) {
    case "create":
      return { draft: taskDraftToDomain(draft as WireParsedTask) };
    case "update":
      return { taskId, draft: taskDraftToDomain(draft as WireParsedTask) };
    case "move":
      return { taskId, status: status as TaskStatus };
    case "schedule":
      return { taskId, deadlineAt: (deadline_at as string | null | undefined) ?? null };
  }
}

export function chatActionToDomain(wire: WireChatAction): ChatAction {
  return {
    id: wire.id,
    kind: wire.kind,
    title: wire.title,
    summary: wire.summary,
    fields: wire.fields.map(chatFieldToDomain),
    status: wire.status,
    payload: chatPayloadToDomain(wire.kind, wire.payload),
  };
}

export function chatMessageToDomain(wire: WireChatMessage): ChatMessage {
  return {
    id: wire.id,
    role: wire.role,
    text: wire.text,
    createdAt: wire.created_at,
    ...(wire.action != null && typeof wire.action === "object"
      ? { action: chatActionToDomain(wire.action) }
      : {}),
  };
}

export function conversationToDomain(wire: WireConversation): Conversation {
  return { id: wire.id, messages: wire.messages.map(chatMessageToDomain) };
}
