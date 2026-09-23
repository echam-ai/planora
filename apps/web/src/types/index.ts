export const APP_NAME = "Planora";

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskCategory = "work" | "personal" | "study" | "other";
export type TaskPriority = "low" | "medium" | "high";

export type TaskUrl = {
  id: string;
  url: string;
  label?: string | undefined;
};

export type Task = {
  id: string;
  title: string;
  content: string;
  status: TaskStatus;
  category: TaskCategory;
  priority: TaskPriority;
  deadlineAt: string | null;
  urls: TaskUrl[];
  markdownNote: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
};

export type AppSettings = {
  timezone: string;
  modelName: string;
};

export type Session = {
  username: string;
  signedInAt: string;
};

export type TaskDraft = {
  title: string;
  content: string;
  category: TaskCategory;
  priority: TaskPriority;
  deadlineAt: string | null;
  urls: TaskUrl[];
  markdownNote: string;
};

export type ParsedTaskText = TaskDraft;

export type ChatActionKind = "create" | "update" | "move" | "schedule";

export type ChatActionField = {
  label: string;
  from?: string;
  to: string;
};

export type ChatAction = {
  id: string;
  kind: ChatActionKind;
  title: string;
  summary: string;
  fields: ChatActionField[];
  status: "pending" | "applied" | "rejected";
  payload: {
    taskId?: string;
    draft?: TaskDraft;
    status?: TaskStatus;
    deadlineAt?: string | null;
  };
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  action?: ChatAction;
};

export type Conversation = {
  id: string;
  messages: ChatMessage[];
};

export type DeadlineState = "none" | "scheduled" | "due_soon" | "overdue" | "completed";

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ApiError";
  }
}
