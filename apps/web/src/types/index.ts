export const APP_NAME = "Planora";

export type {
  ChatAction,
  ChatActionField,
  ChatActionKind,
  ChatActionPayload,
  ChatActionStatus,
  ChatMessage,
  ChatMessageRole,
  Conversation,
} from "@/shared/domain/chat";
export type { AppSettings } from "@/shared/domain/settings";
export type { Credentials, Session } from "@/shared/domain/session";
export type {
  ParsedTaskText,
  Task,
  TaskCategory,
  TaskDraft,
  TaskFormValues,
  TaskPriority,
  TaskStatus,
  TaskUrl,
} from "@/shared/domain/task";

export type DeadlineState = "none" | "scheduled" | "due_soon" | "overdue" | "completed";

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ApiError";
  }
}
