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

/**
 * One field-level validation failure, mapped from the wire's `ValidationErrorDetail`
 * (spec's `422` envelope). Field names on this shape never need snake↔camel
 * conversion, but `http/mappers.ts` still owns constructing it (binding rule 2).
 */
export type ValidationErrorDetail = {
  field: string | null;
  code: string;
  message: string;
};

export type ApiErrorOptions = {
  /** The HTTP status code, when the error came from an HTTP response. */
  status?: number;
  /** Field-level details from a `422` response. */
  details?: ValidationErrorDetail[];
};

export class ApiError extends Error {
  code: string;
  status?: number;
  details?: ValidationErrorDetail[];
  constructor(code: string, message: string, options?: ApiErrorOptions) {
    super(message);
    this.code = code;
    this.name = "ApiError";
    if (options?.status !== undefined) this.status = options.status;
    if (options?.details !== undefined) this.details = options.details;
  }
}
