import { formatInTimeZone } from "date-fns-tz";
import { formatInZone, getDeadlineState } from "@/features/tasks/deadline";
import { zonedDateTimeToIso } from "@/features/tasks/formMapping";
import { uid } from "@/lib/id";
import { AI_TEXT_LIMIT } from "@/shared/api/textLimits";
import {
  ApiError,
  type ChatAction,
  type ChatMessage,
  type Conversation,
  type ParsedTaskText,
  type Task,
  type TaskCategory,
  type TaskDraft,
  type TaskPriority,
  type TaskStatus,
} from "@/types";
import type { ApiClient } from "../ApiClient";
import { currentTimezone } from "./auth";
import { KEYS, delay, ensureTasks, nowIso, read, write } from "./store";

const CATEGORY_WORDS: Record<TaskCategory, string[]> = {
  work: ["work", "meeting", "review", "deck", "client", "sprint", "deploy", "report"],
  personal: ["personal", "home", "family", "errand", "grocery", "doctor", "dentist", "trip"],
  study: ["study", "read", "course", "lecture", "exam", "revision", "chapter", "notes"],
  other: [],
};
const PRIORITY_WORDS: Record<TaskPriority, string[]> = {
  high: ["urgent", "asap", "high-priority", "high priority", "critical", "important"],
  low: ["low priority", "low-priority", "whenever", "someday", "eventually"],
  medium: [],
};
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Interprets relative days and wall-clock times in the Settings timezone,
 * never the browser's (spec §6.1, §11). */
function parseDeadline(text: string, timezone: string): string | null {
  const lower = text.toLowerCase();
  // The calendar date "now" in the Settings zone, as a UTC-midnight anchor so
  // day arithmetic is independent of the process zone.
  const anchor = new Date(`${formatInTimeZone(new Date(), timezone, "yyyy-MM-dd")}T00:00:00Z`);
  const addDays = (days: number) => anchor.setUTCDate(anchor.getUTCDate() + days);
  let matched = false;
  if (lower.includes("tomorrow")) {
    addDays(1);
    matched = true;
  } else if (lower.includes("today") || lower.includes("tonight")) matched = true;
  else if (lower.includes("next week")) {
    addDays(7);
    matched = true;
  } else {
    const day = WEEKDAYS.findIndex((weekday) => lower.includes(weekday));
    if (day >= 0) {
      addDays((day - anchor.getUTCDay() + 7) % 7 || 7);
      matched = true;
    }
  }
  let hours = 17;
  let minutes = 0;
  const time = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (time) {
    hours = parseInt(time[1] ?? "0", 10) % 12;
    if (time[3] === "pm") hours += 12;
    minutes = time[2] ? parseInt(time[2], 10) : 0;
    matched = true;
  }
  if (!matched) return null;
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return zonedDateTimeToIso(anchor.toISOString().slice(0, 10), clock, timezone);
}

function parseText(text: string, timezone: string): ParsedTaskText {
  const lower = text.toLowerCase();
  const urls = (text.match(/https?:\/\/[^\s)]+/g) ?? []).map((url) => ({ id: uid("url"), url }));
  let priority: TaskPriority = "medium";
  for (const candidate of ["high", "low"] as TaskPriority[])
    if (PRIORITY_WORDS[candidate].some((word) => lower.includes(word))) {
      priority = candidate;
      break;
    }
  let category: TaskCategory = "other";
  for (const candidate of ["work", "study", "personal"] as TaskCategory[])
    if (CATEGORY_WORDS[candidate].some((word) => lower.includes(word))) {
      category = candidate;
      break;
    }
  const withoutUrls = text.replace(/https?:\/\/[^\s)]+/g, "").trim();
  const firstSentence = withoutUrls.split(/[.!?\n]/)[0]?.trim() || "New task";
  const title = firstSentence.length > 72 ? `${firstSentence.slice(0, 69)}…` : firstSentence;
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    content: withoutUrls || text,
    category,
    priority,
    deadlineAt: parseDeadline(text, timezone),
    urls,
    markdownNote: "",
  };
}

function emptyConversation(): Conversation {
  return { id: uid("conv"), messages: [] };
}
function statusLabel(status: TaskStatus) {
  return status === "todo" ? "Todo" : status === "in_progress" ? "In Progress" : "Done";
}
function taskToDraft(task: Task): TaskDraft {
  return {
    title: task.title,
    content: task.content,
    category: task.category,
    priority: task.priority,
    deadlineAt: task.deadlineAt,
    urls: task.urls,
    markdownNote: task.markdownNote,
  };
}
function findTaskByPhrase(tasks: Task[], text: string) {
  const quoted = text.match(/[‘'"“]([^’'"”]+)[’'"”]/)?.[1];
  const needle = (quoted ?? "").toLowerCase().trim();
  return needle
    ? tasks.find((task) => task.title.toLowerCase().includes(needle))
    : tasks.find((task) => text.toLowerCase().includes(task.title.toLowerCase().slice(0, 12)));
}
function describeTask(task: Task, timezone: string) {
  const deadline = task.deadlineAt ? formatInZone(task.deadlineAt, timezone) : "no deadline";
  return `• ${task.title} — ${task.priority} priority, ${task.category}, ${deadline}`;
}

function buildAssistantReply(text: string, tasks: Task[], timezone: string): ChatMessage {
  const lower = text.toLowerCase();
  const active = tasks.filter((task) => !task.archivedAt);
  const base = { id: uid("msg"), role: "assistant" as const, createdAt: nowIso() };
  const action = (value: Omit<ChatAction, "id" | "status">): ChatAction => ({
    id: uid("act"),
    status: "pending",
    ...value,
  });
  if (/\bmove\b|\bstart\b|\bmark\b/.test(lower)) {
    const task = findTaskByPhrase(active, text);
    if (task) {
      const status: TaskStatus = lower.includes("done")
        ? "done"
        : lower.includes("todo")
          ? "todo"
          : "in_progress";
      return {
        ...base,
        text: "I can move this task for you. Confirm below and I'll apply it.",
        action: action({
          kind: "move",
          title: "Move task",
          summary: task.title,
          fields: [{ label: "Status", from: statusLabel(task.status), to: statusLabel(status) }],
          payload: { taskId: task.id, status },
        }),
      };
    }
  }
  if (
    /\b(reschedule|schedule|due|deadline|postpone)\b/.test(lower) &&
    !/^what|^show|^list/.test(lower)
  ) {
    const task = findTaskByPhrase(active, text);
    const deadline = parseDeadline(text, timezone);
    if (task && deadline)
      return {
        ...base,
        text: "Here's the deadline change I'd make.",
        action: action({
          kind: "schedule",
          title: "Change deadline",
          summary: task.title,
          fields: [
            {
              label: "Deadline",
              from: task.deadlineAt ? formatInZone(task.deadlineAt, timezone) : "No deadline",
              to: formatInZone(deadline, timezone),
            },
          ],
          payload: { taskId: task.id, deadlineAt: deadline },
        }),
      };
  }
  if (/\b(rename|change the title|set priority|make it high|make it low)\b/.test(lower)) {
    const task = findTaskByPhrase(active, text);
    if (task) {
      const priority: TaskPriority = lower.includes("low") ? "low" : "high";
      return {
        ...base,
        text: "I'd update this task as follows.",
        action: action({
          kind: "update",
          title: "Update task",
          summary: task.title,
          fields: [{ label: "Priority", from: task.priority, to: priority }],
          payload: { taskId: task.id, draft: { ...taskToDraft(task), priority } },
        }),
      };
    }
  }
  if (/\b(add|create|remind me to|new task)\b/.test(lower)) {
    const draft = parseText(
      text.replace(/^(add|create)\s+(a\s+)?task\s*(to)?/i, "").trim() || text,
      timezone,
    );
    return {
      ...base,
      text: "I drafted this task from your message. Review and confirm to create it.",
      action: action({
        kind: "create",
        title: "Create task",
        summary: draft.title,
        fields: [
          { label: "Title", to: draft.title },
          { label: "Category", to: draft.category },
          { label: "Priority", to: draft.priority },
          {
            label: "Deadline",
            to: draft.deadlineAt ? formatInZone(draft.deadlineAt, timezone) : "None",
          },
        ],
        payload: { draft },
      }),
    };
  }
  if (lower.includes("overdue")) {
    const hits = active.filter((task) => getDeadlineState(task) === "overdue");
    return {
      ...base,
      text: hits.length
        ? `You have ${hits.length} overdue task${hits.length > 1 ? "s" : ""}:\n${hits.map((hit) => describeTask(hit, timezone)).join("\n")}`
        : "Nothing is overdue right now. Nice.",
    };
  }
  if (lower.includes("due soon") || lower.includes("near deadline") || lower.includes("today")) {
    const hits = active.filter((task) => getDeadlineState(task) === "due_soon");
    return {
      ...base,
      text: hits.length
        ? `Due within 24 hours:\n${hits.map((hit) => describeTask(hit, timezone)).join("\n")}`
        : "Nothing is due within the next 24 hours.",
    };
  }
  const category = (["work", "personal", "study", "other"] as TaskCategory[]).find((candidate) =>
    lower.includes(candidate),
  );
  const priority = (["high", "medium", "low"] as TaskPriority[]).find((candidate) =>
    lower.includes(candidate),
  );
  if (category || priority) {
    const hits = active.filter(
      (task) =>
        (!category || task.category === category) && (!priority || task.priority === priority),
    );
    return {
      ...base,
      text: hits.length
        ? `Found ${hits.length} matching task${hits.length > 1 ? "s" : ""}:\n${hits.map((hit) => describeTask(hit, timezone)).join("\n")}`
        : "No tasks match that description.",
    };
  }
  const counts = {
    todo: active.filter((task) => task.status === "todo").length,
    in_progress: active.filter((task) => task.status === "in_progress").length,
    done: active.filter((task) => task.status === "done").length,
  };
  return {
    ...base,
    text: `Right now you have ${counts.todo} in Todo, ${counts.in_progress} in Progress and ${counts.done} Done. Ask me what's overdue, filter by category or priority, or ask me to add or move a task.`,
  };
}

const NOT_FOUND_MESSAGE = "That proposed change is no longer available.";
const ALREADY_REJECTED_MESSAGE = "This change was cancelled, so it wasn't applied.";
const STALE_MESSAGE =
  "This task changed after the proposal, so nothing was applied. Ask for an up-to-date preview.";
const ALREADY_APPLIED_MESSAGE = "This change has already been applied.";

export function createChatClient(
  tasksClient: Pick<ApiClient, "createTask" | "moveTask" | "updateTask">,
): Pick<
  ApiClient,
  | "parseTaskText"
  | "getCurrentConversation"
  | "sendChatMessage"
  | "startNewConversation"
  | "confirmChatAction"
  | "rejectChatAction"
> {
  return {
    async parseTaskText(text) {
      await delay(700, 1400);
      if ([...text.trim()].length > AI_TEXT_LIMIT)
        throw new ApiError("VALIDATION_ERROR", "Request validation failed.", {
          status: 422,
          details: [{ field: "text", code: "VALUE_ERROR", message: "Text is too long." }],
        });
      if (read<boolean>(KEYS.forceError, false) || /\bfail\b/i.test(text))
        throw new ApiError("AI_UNAVAILABLE", "The assistant is unavailable right now. Try again.", {
          status: 503,
        });
      return parseText(text, currentTimezone());
    },
    async getCurrentConversation() {
      await delay(150, 300);
      const conversation = read<Conversation | null>(KEYS.conversation, null);
      if (conversation) return conversation;
      const fresh = emptyConversation();
      write(KEYS.conversation, fresh);
      return fresh;
    },
    async sendChatMessage(text) {
      await delay(600, 1200);
      // Like the API, a failed send persists nothing — not even the user's message.
      if (read<boolean>(KEYS.forceError, false))
        throw new ApiError("AI_UNAVAILABLE", "The assistant is unavailable right now. Try again.", {
          status: 503,
        });
      const conversation =
        read<Conversation | null>(KEYS.conversation, null) ?? emptyConversation();
      conversation.messages.push({ id: uid("msg"), role: "user", text, createdAt: nowIso() });
      conversation.messages.push(buildAssistantReply(text, ensureTasks(), currentTimezone()));
      write(KEYS.conversation, conversation);
      return conversation;
    },
    async startNewConversation() {
      await delay(150, 300);
      const fresh = emptyConversation();
      write(KEYS.conversation, fresh);
      return fresh;
    },
    async confirmChatAction(actionId) {
      await delay();
      const conversation =
        read<Conversation | null>(KEYS.conversation, null) ?? emptyConversation();
      const proposed = conversation.messages.find(
        (message) => message.action?.id === actionId,
      )?.action;
      if (!proposed) throw new ApiError("NOT_FOUND", NOT_FOUND_MESSAGE, { status: 404 });
      if (proposed.status === "rejected")
        throw new ApiError("ACTION_ALREADY_REJECTED", ALREADY_REJECTED_MESSAGE, { status: 409 });
      if (proposed.status === "applied") return conversation;
      // The mock keeps no snapshot, so only a target that is no longer active counts as stale.
      if (proposed.kind !== "create" && proposed.payload.taskId) {
        const target = ensureTasks().find((task) => task.id === proposed.payload.taskId);
        if (!target || target.archivedAt)
          throw new ApiError("ACTION_STALE", STALE_MESSAGE, { status: 409 });
      }
      if (proposed.kind === "create" && proposed.payload.draft)
        await tasksClient.createTask(proposed.payload.draft);
      else if (proposed.kind === "move" && proposed.payload.taskId && proposed.payload.status)
        await tasksClient.moveTask(proposed.payload.taskId, proposed.payload.status, 0);
      else if (proposed.kind === "schedule" && proposed.payload.taskId)
        await tasksClient.updateTask(proposed.payload.taskId, {
          deadlineAt: proposed.payload.deadlineAt ?? null,
        });
      else if (proposed.kind === "update" && proposed.payload.taskId && proposed.payload.draft)
        await tasksClient.updateTask(proposed.payload.taskId, proposed.payload.draft);
      proposed.status = "applied";
      conversation.messages.push({
        id: uid("msg"),
        role: "assistant",
        text: "Done — I applied that change to your board.",
        createdAt: nowIso(),
      });
      write(KEYS.conversation, conversation);
      return conversation;
    },
    async rejectChatAction(actionId) {
      await delay(150, 300);
      const conversation =
        read<Conversation | null>(KEYS.conversation, null) ?? emptyConversation();
      const action = conversation.messages.find(
        (message) => message.action?.id === actionId,
      )?.action;
      if (!action) throw new ApiError("NOT_FOUND", NOT_FOUND_MESSAGE, { status: 404 });
      if (action.status === "applied")
        throw new ApiError("ACTION_ALREADY_APPLIED", ALREADY_APPLIED_MESSAGE, { status: 409 });
      action.status = "rejected";
      write(KEYS.conversation, conversation);
      return conversation;
    },
  };
}
