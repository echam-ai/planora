import type { ProfileId } from "./profiles";
import type {
  AppSettings,
  Conversation,
  ParsedTaskText,
  Task,
  TaskDraft,
  TaskStatus,
} from "@/types";

export type ArchivePage = {
  items: Task[];
  total: number;
  page: number;
  pageSize: number;
};

export interface ApiClient {
  /**
   * The site-password gate (#124). `getAccess` never rejects with 401: it is how the app learns
   * whether to show the password page. Every other method rejects with 401 `NOT_AUTHENTICATED`
   * while locked. `unlock` rejects with 401 `INVALID_PASSWORD` for a wrong password.
   */
  getAccess(): Promise<{ authenticated: boolean }>;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;

  getProfiles(): Promise<ReadonlyArray<{ id: ProfileId; name: string }>>;

  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task>;
  createTask(draft: TaskDraft): Promise<Task>;
  updateTask(id: string, patch: Partial<TaskDraft> & { status?: TaskStatus }): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  moveTask(id: string, status: TaskStatus, position: number): Promise<Task[]>;
  reorderTasks(status: TaskStatus, orderedIds: string[]): Promise<Task[]>;

  /**
   * `signal` is optional on both AI calls. Aborting it cancels the request and rejects with an
   * `AbortError` (never an `ApiError`); a cancelled call has no effect on stored data.
   */
  parseTaskText(text: string, signal?: AbortSignal): Promise<ParsedTaskText>;

  listArchive(search?: string, page?: number): Promise<ArchivePage>;
  getArchivedTask(id: string): Promise<Task>;
  restoreTask(id: string): Promise<Task>;
  permanentlyDeleteTask(id: string): Promise<void>;

  getCurrentConversation(): Promise<Conversation>;
  sendChatMessage(text: string, signal?: AbortSignal): Promise<Conversation>;
  startNewConversation(): Promise<Conversation>;
  confirmChatAction(actionId: string): Promise<Conversation>;
  rejectChatAction(actionId: string): Promise<Conversation>;

  resetDemoData(): Promise<void>;
}
