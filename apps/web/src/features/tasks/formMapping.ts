import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { TaskFormValues } from "@/shared/domain/task";
import type { TaskCategory, TaskDraft, TaskPriority } from "@/types";

const DATE_KEY = "yyyy-MM-dd";

/** The deadline's wall-clock date and time in `timezone`, for form prefill.
 * Never derived from the browser's local zone. */
export function toZonedDateTime(
  iso: string | null,
  timezone: string,
): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  return {
    date: formatInTimeZone(iso, timezone, DATE_KEY),
    time: formatInTimeZone(iso, timezone, "HH:mm"),
  };
}

/** A wall-clock date and time, interpreted in `timezone`, as the UTC instant
 * it represents. `null` when either half is missing. */
export function zonedDateTimeToIso(
  date: string | undefined,
  time: string | undefined,
  timezone: string,
): string | null {
  if (!date || !time) return null;
  return fromZonedTime(`${date}T${time}:00`, timezone).toISOString();
}

export function draftToValues(draft: TaskDraft, timezone: string): TaskFormValues {
  const { date, time } = toZonedDateTime(draft.deadlineAt, timezone);
  return {
    title: draft.title,
    content: draft.content,
    category: draft.category,
    priority: draft.priority,
    deadlineDate: date,
    deadlineTime: time,
    markdownNote: draft.markdownNote,
    urls: draft.urls.map((u) => ({ id: u.id, url: u.url, label: u.label ?? "" })),
  };
}

export function valuesToDraft(values: TaskFormValues, timezone: string): TaskDraft {
  return {
    title: values.title.trim(),
    content: values.content.trim(),
    category: values.category as TaskCategory,
    priority: values.priority as TaskPriority,
    deadlineAt: zonedDateTimeToIso(values.deadlineDate, values.deadlineTime, timezone),
    markdownNote: values.markdownNote,
    urls: values.urls.map((u) => ({
      id: u.id,
      url: u.url.trim(),
      label: u.label?.trim() || undefined,
    })),
  };
}

/** react-hook-form's dirty map: `true` on edited inputs, nested for link rows. */
export type TaskFormDirty = Partial<Record<keyof TaskFormValues, unknown>>;

function hasDirty(node: unknown): boolean {
  if (!node) return false;
  if (Array.isArray(node)) return node.some(hasDirty);
  if (typeof node === "object") return Object.values(node).some(hasDirty);
  return true;
}

/** The draft fields the user actually edited, as an `updateTask` patch. */
export function dirtyDraftPatch(
  values: TaskFormValues,
  dirtyFields: TaskFormDirty,
  timezone: string,
): Partial<TaskDraft> {
  const draft = valuesToDraft(values, timezone);
  const patch: Partial<TaskDraft> = {};
  if (hasDirty(dirtyFields.title)) patch.title = draft.title;
  if (hasDirty(dirtyFields.content)) patch.content = draft.content;
  if (hasDirty(dirtyFields.category)) patch.category = draft.category;
  if (hasDirty(dirtyFields.priority)) patch.priority = draft.priority;
  if (hasDirty(dirtyFields.deadlineDate) || hasDirty(dirtyFields.deadlineTime)) {
    patch.deadlineAt = draft.deadlineAt;
  }
  if (hasDirty(dirtyFields.markdownNote)) patch.markdownNote = draft.markdownNote;
  if (hasDirty(dirtyFields.urls)) patch.urls = draft.urls;
  return patch;
}

export const emptyDraft: TaskDraft = {
  title: "",
  content: "",
  category: "work",
  priority: "medium",
  deadlineAt: null,
  urls: [],
  markdownNote: "",
};
