/**
 * The only snake_case ↔ camelCase converter in the web tier (binding rule 2).
 * Every HTTP endpoint function in `httpApiClient.ts` builds its request body
 * and query string here, and maps every response here — nothing else in
 * `src` should reference a wire field name like `deadline_at`.
 */
import type { paths } from "@/shared/api/schema.gen";
import type { ArchivePage } from "../ApiClient";
import type { AppSettings, Session, Task, TaskDraft, TaskStatus, TaskUrl } from "@/types";

type WireTask =
  paths["/api/v1/tasks/{task_id}"]["get"]["responses"][200]["content"]["application/json"];
type WireTaskUrl = WireTask["urls"][number];
type WireTaskCreate = paths["/api/v1/tasks"]["post"]["requestBody"]["content"]["application/json"];
type WireTaskUpdate =
  paths["/api/v1/tasks/{task_id}"]["patch"]["requestBody"]["content"]["application/json"];
type WireSession =
  paths["/api/v1/auth/login"]["post"]["responses"][200]["content"]["application/json"];
type WireSettings =
  paths["/api/v1/settings"]["get"]["responses"][200]["content"]["application/json"];
type WireSettingsUpdate =
  paths["/api/v1/settings"]["patch"]["requestBody"]["content"]["application/json"];
type WirePasswordChange =
  paths["/api/v1/settings/password"]["post"]["requestBody"]["content"]["application/json"];
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

export function sessionToDomain(wire: WireSession): Session {
  return { username: wire.username, signedInAt: wire.signed_in_at };
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

export function passwordChangeToWire(
  currentPassword: string,
  newPassword: string,
): WirePasswordChange {
  return { current_password: currentPassword, new_password: newPassword };
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
