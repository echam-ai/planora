import type {
  AppSettings,
  Conversation,
  ParsedTaskText,
  Session,
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
  login(username: string, password: string): Promise<Session>;
  logout(): Promise<void>;
  getSession(): Promise<Session | null>;

  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;

  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task>;
  createTask(draft: TaskDraft): Promise<Task>;
  updateTask(id: string, patch: Partial<TaskDraft> & { status?: TaskStatus }): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  moveTask(id: string, status: TaskStatus, position: number): Promise<Task[]>;
  reorderTasks(status: TaskStatus, orderedIds: string[]): Promise<Task[]>;

  parseTaskText(text: string): Promise<ParsedTaskText>;

  listArchive(search?: string, page?: number): Promise<ArchivePage>;
  getArchivedTask(id: string): Promise<Task>;
  restoreTask(id: string): Promise<Task>;
  permanentlyDeleteTask(id: string): Promise<void>;

  getCurrentConversation(): Promise<Conversation>;
  sendChatMessage(text: string): Promise<Conversation>;
  startNewConversation(): Promise<Conversation>;
  confirmChatAction(actionId: string): Promise<Conversation>;
  rejectChatAction(actionId: string): Promise<Conversation>;

  resetDemoData(): Promise<void>;
}
