import { createSeedTasks, uid } from "@/data/seed";
import { getDeadlineState } from "@/lib/deadline";
import {
  ApiError,
  type AppSettings,
  type ChatAction,
  type ChatMessage,
  type Conversation,
  type ParsedTaskText,
  type Session,
  type Task,
  type TaskCategory,
  type TaskDraft,
  type TaskPriority,
  type TaskStatus,
} from "@/types";
import type { ApiClient, ArchivePage } from "./ApiClient";

const KEYS = {
  tasks: "planora.tasks",
  settings: "planora.settings",
  session: "planora.session",
  conversation: "planora.conversation",
  password: "planora.password",
  forceError: "planora.forceError",
};

const DEFAULT_SETTINGS: AppSettings = { timezone: "Asia/Singapore", modelName: "kimi-k3" };
const DEMO_USER = "demo";
const DEFAULT_PASSWORD = "focusboard";

const hasWindow = () => typeof window !== "undefined";

function read<T>(key: string, fallback: T): T {
  if (!hasWindow()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (!hasWindow()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function delay(min = 250, max = 600) {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

function ensureTasks(): Task[] {
  if (!hasWindow()) return [];
  const existing = read<Task[] | null>(KEYS.tasks, null);
  if (existing && existing.length) return existing;
  const seeded = createSeedTasks();
  write(KEYS.tasks, seeded);
  return seeded;
}

function saveTasks(tasks: Task[]) {
  write(KEYS.tasks, tasks);
}

function nowIso() {
  return new Date().toISOString();
}

function normalisePositions(tasks: Task[]): Task[] {
  const statuses: TaskStatus[] = ["todo", "in_progress", "done"];
  const active = tasks.filter((t) => !t.archivedAt);
  statuses.forEach((s) => {
    active
      .filter((t) => t.status === s)
      .sort((a, b) => a.position - b.position)
      .forEach((t, i) => {
        t.position = i;
      });
  });
  return tasks;
}

function maybeFail(action: string) {
  if (read<boolean>(KEYS.forceError, false)) {
    throw new ApiError("SIMULATED_FAILURE", `Simulated failure while trying to ${action}.`);
  }
}

/* ------------------------------ text parsing ------------------------------ */

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

function parseDeadline(text: string): string | null {
  const lower = text.toLowerCase();
  const now = new Date();
  const target = new Date(now);
  let matched = false;

  if (lower.includes("tomorrow")) {
    target.setDate(target.getDate() + 1);
    matched = true;
  } else if (lower.includes("today") || lower.includes("tonight")) {
    matched = true;
  } else if (lower.includes("next week")) {
    target.setDate(target.getDate() + 7);
    matched = true;
  } else {
    const day = WEEKDAYS.findIndex((d) => lower.includes(d));
    if (day >= 0) {
      const diff = (day - target.getDay() + 7) % 7 || 7;
      target.setDate(target.getDate() + diff);
      matched = true;
    }
  }

  const time = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (time) {
    let hours = parseInt(time[1] ?? "0", 10) % 12;
    if (time[3] === "pm") hours += 12;
    target.setHours(hours, time[2] ? parseInt(time[2], 10) : 0, 0, 0);
    matched = true;
  } else if (matched) {
    target.setHours(17, 0, 0, 0);
  }

  return matched ? target.toISOString() : null;
}

function parseText(text: string): ParsedTaskText {
  const lower = text.toLowerCase();
  const urls = (text.match(/https?:\/\/[^\s)]+/g) ?? []).map((u) => ({ id: uid("url"), url: u }));

  let priority: TaskPriority = "medium";
  for (const p of ["high", "low"] as TaskPriority[]) {
    if (PRIORITY_WORDS[p].some((w) => lower.includes(w))) {
      priority = p;
      break;
    }
  }

  let category: TaskCategory = "other";
  for (const c of ["work", "study", "personal"] as TaskCategory[]) {
    if (CATEGORY_WORDS[c].some((w) => lower.includes(w))) {
      category = c;
      break;
    }
  }

  const withoutUrls = text.replace(/https?:\/\/[^\s)]+/g, "").trim();
  const firstSentence = withoutUrls.split(/[.!?\n]/)[0]?.trim() || "New task";
  const title = firstSentence.length > 72 ? `${firstSentence.slice(0, 69)}…` : firstSentence;

  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    content: withoutUrls || text,
    category,
    priority,
    deadlineAt: parseDeadline(text),
    urls,
    markdownNote: "",
  };
}

/* --------------------------------- chat ---------------------------------- */

function emptyConversation(): Conversation {
  return { id: uid("conv"), messages: [] };
}

function describeTask(t: Task) {
  const deadline = t.deadlineAt
    ? new Date(t.deadlineAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "no deadline";
  return `• ${t.title} — ${t.priority} priority, ${t.category}, ${deadline}`;
}

function statusLabel(s: TaskStatus) {
  return s === "todo" ? "Todo" : s === "in_progress" ? "In Progress" : "Done";
}

function findTaskByPhrase(tasks: Task[], text: string): Task | undefined {
  const quoted = text.match(/[‘'"“]([^’'"”]+)[’'"”]/)?.[1];
  const needle = (quoted ?? "").toLowerCase().trim();
  if (needle) {
    const hit = tasks.find((t) => t.title.toLowerCase().includes(needle));
    if (hit) return hit;
  }
  return tasks.find((t) => text.toLowerCase().includes(t.title.toLowerCase().slice(0, 12)));
}

function buildAssistantReply(text: string, tasks: Task[]): ChatMessage {
  const lower = text.toLowerCase();
  const active = tasks.filter((t) => !t.archivedAt);
  const base = { id: uid("msg"), role: "assistant" as const, createdAt: nowIso() };

  const makeAction = (a: Omit<ChatAction, "id" | "status">): ChatAction => ({
    id: uid("act"),
    status: "pending",
    ...a,
  });

  // Move request
  if (/\bmove\b|\bstart\b|\bmark\b/.test(lower)) {
    const task = findTaskByPhrase(active, text);
    if (task) {
      const to: TaskStatus = lower.includes("done")
        ? "done"
        : lower.includes("todo")
          ? "todo"
          : "in_progress";
      return {
        ...base,
        text: `I can move this task for you. Confirm below and I'll apply it.`,
        action: makeAction({
          kind: "move",
          title: "Move task",
          summary: task.title,
          fields: [{ label: "Status", from: statusLabel(task.status), to: statusLabel(to) }],
          payload: { taskId: task.id, status: to },
        }),
      };
    }
  }

  // Schedule request
  if (
    /\b(reschedule|schedule|due|deadline|postpone)\b/.test(lower) &&
    !/^what|^show|^list/.test(lower)
  ) {
    const task = findTaskByPhrase(active, text);
    const newDeadline = parseDeadline(text);
    if (task && newDeadline) {
      return {
        ...base,
        text: "Here's the deadline change I'd make.",
        action: makeAction({
          kind: "schedule",
          title: "Change deadline",
          summary: task.title,
          fields: [
            {
              label: "Deadline",
              from: task.deadlineAt
                ? new Date(task.deadlineAt).toLocaleString("en-GB")
                : "No deadline",
              to: new Date(newDeadline).toLocaleString("en-GB"),
            },
          ],
          payload: { taskId: task.id, deadlineAt: newDeadline },
        }),
      };
    }
  }

  // Edit request
  if (/\b(rename|change the title|set priority|make it high|make it low)\b/.test(lower)) {
    const task = findTaskByPhrase(active, text);
    if (task) {
      const priority: TaskPriority = lower.includes("low") ? "low" : "high";
      return {
        ...base,
        text: "I'd update this task as follows.",
        action: makeAction({
          kind: "update",
          title: "Update task",
          summary: task.title,
          fields: [{ label: "Priority", from: task.priority, to: priority }],
          payload: { taskId: task.id, draft: { ...taskToDraft(task), priority } },
        }),
      };
    }
  }

  // Create request
  if (/\b(add|create|remind me to|new task)\b/.test(lower)) {
    const draft = parseText(
      text.replace(/^(add|create)\s+(a\s+)?task\s*(to)?/i, "").trim() || text,
    );
    return {
      ...base,
      text: "I drafted this task from your message. Review and confirm to create it.",
      action: makeAction({
        kind: "create",
        title: "Create task",
        summary: draft.title,
        fields: [
          { label: "Title", to: draft.title },
          { label: "Category", to: draft.category },
          { label: "Priority", to: draft.priority },
          {
            label: "Deadline",
            to: draft.deadlineAt ? new Date(draft.deadlineAt).toLocaleString("en-GB") : "None",
          },
        ],
        payload: { draft },
      }),
    };
  }

  // Read-only queries
  if (lower.includes("overdue")) {
    const hits = active.filter((t) => getDeadlineState(t) === "overdue");
    return {
      ...base,
      text: hits.length
        ? `You have ${hits.length} overdue task${hits.length > 1 ? "s" : ""}:\n${hits.map(describeTask).join("\n")}`
        : "Nothing is overdue right now. Nice.",
    };
  }

  if (lower.includes("due soon") || lower.includes("today")) {
    const hits = active.filter((t) => getDeadlineState(t) === "due_soon");
    return {
      ...base,
      text: hits.length
        ? `Due within 24 hours:\n${hits.map(describeTask).join("\n")}`
        : "Nothing is due within the next 24 hours.",
    };
  }

  const cat = (["work", "personal", "study", "other"] as TaskCategory[]).find((c) =>
    lower.includes(c),
  );
  const prio = (["high", "medium", "low"] as TaskPriority[]).find((p) => lower.includes(p));
  if (cat || prio) {
    const hits = active.filter(
      (t) => (!cat || t.category === cat) && (!prio || t.priority === prio),
    );
    return {
      ...base,
      text: hits.length
        ? `Found ${hits.length} matching task${hits.length > 1 ? "s" : ""}:\n${hits.map(describeTask).join("\n")}`
        : "No tasks match that description.",
    };
  }

  const counts = {
    todo: active.filter((t) => t.status === "todo").length,
    in_progress: active.filter((t) => t.status === "in_progress").length,
    done: active.filter((t) => t.status === "done").length,
  };
  return {
    ...base,
    text: `Right now you have ${counts.todo} in Todo, ${counts.in_progress} in Progress and ${counts.done} Done. Ask me what's overdue, filter by category or priority, or ask me to add or move a task.`,
  };
}

function taskToDraft(t: Task): TaskDraft {
  return {
    title: t.title,
    content: t.content,
    category: t.category,
    priority: t.priority,
    deadlineAt: t.deadlineAt,
    urls: t.urls,
    markdownNote: t.markdownNote,
  };
}

/* ------------------------------- the client ------------------------------- */

export const mockApiClient: ApiClient = {
  async login(username, password) {
    await delay();
    const stored = read<string>(KEYS.password, DEFAULT_PASSWORD);
    if (username.trim().toLowerCase() !== DEMO_USER || password !== stored) {
      throw new ApiError("INVALID_CREDENTIALS", "That username or password isn't right.");
    }
    const session: Session = { username: DEMO_USER, signedInAt: nowIso() };
    write(KEYS.session, session);
    ensureTasks();
    return session;
  },

  async logout() {
    await delay(150, 300);
    if (hasWindow()) window.localStorage.removeItem(KEYS.session);
  },

  async getSession() {
    await delay(120, 260);
    return read<Session | null>(KEYS.session, null);
  },

  async getSettings() {
    await delay();
    return { ...DEFAULT_SETTINGS, ...read<Partial<AppSettings>>(KEYS.settings, {}) };
  },

  async updateSettings(patch) {
    await delay();
    maybeFail("save settings");
    const next = {
      ...DEFAULT_SETTINGS,
      ...read<Partial<AppSettings>>(KEYS.settings, {}),
      ...patch,
    };
    write(KEYS.settings, next);
    return next;
  },

  async changePassword(currentPassword, newPassword) {
    await delay();
    const stored = read<string>(KEYS.password, DEFAULT_PASSWORD);
    if (currentPassword !== stored) {
      throw new ApiError("WRONG_PASSWORD", "Your current password is incorrect.");
    }
    write(KEYS.password, newPassword);
  },

  async listTasks() {
    await delay();
    return ensureTasks().filter((t) => !t.archivedAt);
  },

  async getTask(id) {
    await delay(150, 300);
    const task = ensureTasks().find((t) => t.id === id);
    if (!task) throw new ApiError("NOT_FOUND", "That task no longer exists.");
    return task;
  },

  async createTask(draft) {
    await delay();
    maybeFail("create the task");
    const tasks = ensureTasks();
    const position = tasks.filter((t) => !t.archivedAt && t.status === "todo").length;
    const task: Task = {
      id: uid("task"),
      ...draft,
      status: "todo",
      position,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: null,
      archivedAt: null,
    };
    saveTasks([...tasks, task]);
    return task;
  },

  async updateTask(id, patch) {
    await delay();
    maybeFail("save the task");
    const tasks = ensureTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new ApiError("NOT_FOUND", "That task no longer exists.");
    Object.assign(task, patch, { updatedAt: nowIso() });
    if (patch.status === "done" && !task.completedAt) task.completedAt = nowIso();
    if (patch.status && patch.status !== "done") task.completedAt = null;
    saveTasks(normalisePositions(tasks));
    return task;
  },

  async deleteTask(id) {
    await delay();
    maybeFail("delete the task");
    saveTasks(normalisePositions(ensureTasks().filter((t) => t.id !== id)));
  },

  async moveTask(id, status, position) {
    await delay();
    maybeFail("move the task");
    const tasks = ensureTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new ApiError("NOT_FOUND", "That task no longer exists.");
    const target = tasks
      .filter((t) => !t.archivedAt && t.status === status && t.id !== id)
      .sort((a, b) => a.position - b.position);
    target.splice(Math.max(0, Math.min(position, target.length)), 0, task);
    task.status = status;
    task.updatedAt = nowIso();
    if (status === "done" && !task.completedAt) task.completedAt = nowIso();
    if (status !== "done") task.completedAt = null;
    target.forEach((t, i) => {
      t.position = i;
    });
    saveTasks(normalisePositions(tasks));
    return tasks.filter((t) => !t.archivedAt);
  },

  async reorderTasks(status, orderedIds) {
    await delay();
    maybeFail("reorder tasks");
    const tasks = ensureTasks();
    orderedIds.forEach((id, i) => {
      const t = tasks.find((x) => x.id === id);
      if (t && t.status === status) t.position = i;
    });
    saveTasks(tasks);
    return tasks.filter((t) => !t.archivedAt);
  },

  async parseTaskText(text) {
    await delay(700, 1400);
    if (read<boolean>(KEYS.forceError, false) || /\bfail\b/i.test(text)) {
      throw new ApiError("AI_UNAVAILABLE", "The assistant couldn't parse that right now.");
    }
    return parseText(text);
  },

  async listArchive(search = "", page = 1): Promise<ArchivePage> {
    await delay();
    const pageSize = 10;
    const all = ensureTasks()
      .filter((t) => t.archivedAt)
      .filter((t) => t.title.toLowerCase().includes(search.trim().toLowerCase()))
      .sort(
        (a, b) =>
          new Date(b.completedAt ?? b.archivedAt!).getTime() -
          new Date(a.completedAt ?? a.archivedAt!).getTime(),
      );
    return {
      items: all.slice((page - 1) * pageSize, page * pageSize),
      total: all.length,
      page,
      pageSize,
    };
  },

  async getArchivedTask(id) {
    await delay(150, 300);
    const task = ensureTasks().find((t) => t.id === id && t.archivedAt);
    if (!task) throw new ApiError("NOT_FOUND", "That archived task no longer exists.");
    return task;
  },

  async restoreTask(id) {
    await delay();
    maybeFail("restore the task");
    const tasks = ensureTasks();
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new ApiError("NOT_FOUND", "That archived task no longer exists.");
    task.archivedAt = null;
    task.completedAt = null;
    task.status = "todo";
    task.updatedAt = nowIso();
    task.position = tasks.filter((t) => !t.archivedAt && t.status === "todo").length;
    saveTasks(normalisePositions(tasks));
    return task;
  },

  async permanentlyDeleteTask(id) {
    await delay();
    maybeFail("delete the task");
    saveTasks(ensureTasks().filter((t) => t.id !== id));
  },

  async getCurrentConversation() {
    await delay(150, 300);
    const conv = read<Conversation | null>(KEYS.conversation, null);
    if (conv) return conv;
    const fresh = emptyConversation();
    write(KEYS.conversation, fresh);
    return fresh;
  },

  async sendChatMessage(text) {
    const conv = read<Conversation | null>(KEYS.conversation, null) ?? emptyConversation();
    conv.messages.push({ id: uid("msg"), role: "user", text, createdAt: nowIso() });
    write(KEYS.conversation, conv);
    await delay(600, 1200);
    if (read<boolean>(KEYS.forceError, false)) {
      throw new ApiError("AI_UNAVAILABLE", "The assistant is unavailable. Try again.");
    }
    conv.messages.push(buildAssistantReply(text, ensureTasks()));
    write(KEYS.conversation, conv);
    return conv;
  },

  async startNewConversation() {
    await delay(150, 300);
    const fresh = emptyConversation();
    write(KEYS.conversation, fresh);
    return fresh;
  },

  async confirmChatAction(actionId) {
    await delay();
    const conv = read<Conversation | null>(KEYS.conversation, null) ?? emptyConversation();
    const message = conv.messages.find((m) => m.action?.id === actionId);
    const action = message?.action;
    if (!action) throw new ApiError("NOT_FOUND", "That proposed action is gone.");
    if (action.status !== "pending") return conv;

    if (action.kind === "create" && action.payload.draft) {
      await mockApiClient.createTask(action.payload.draft);
    } else if (action.kind === "move" && action.payload.taskId && action.payload.status) {
      await mockApiClient.moveTask(action.payload.taskId, action.payload.status, 0);
    } else if (action.kind === "schedule" && action.payload.taskId) {
      await mockApiClient.updateTask(action.payload.taskId, {
        deadlineAt: action.payload.deadlineAt ?? null,
      });
    } else if (action.kind === "update" && action.payload.taskId && action.payload.draft) {
      await mockApiClient.updateTask(action.payload.taskId, action.payload.draft);
    }

    action.status = "applied";
    conv.messages.push({
      id: uid("msg"),
      role: "assistant",
      text: "Done — I applied that change to your board.",
      createdAt: nowIso(),
    });
    write(KEYS.conversation, conv);
    return conv;
  },

  async rejectChatAction(actionId) {
    await delay(150, 300);
    const conv = read<Conversation | null>(KEYS.conversation, null) ?? emptyConversation();
    const action = conv.messages.find((m) => m.action?.id === actionId)?.action;
    if (action && action.status === "pending") action.status = "rejected";
    write(KEYS.conversation, conv);
    return conv;
  },

  async resetDemoData() {
    await delay();
    if (!hasWindow()) return;
    window.localStorage.removeItem(KEYS.tasks);
    window.localStorage.removeItem(KEYS.conversation);
    window.localStorage.removeItem(KEYS.settings);
    ensureTasks();
  },
};

export const mockDevTools = {
  isErrorModeOn: () => read<boolean>(KEYS.forceError, false),
  setErrorMode: (on: boolean) => write(KEYS.forceError, on),
};
