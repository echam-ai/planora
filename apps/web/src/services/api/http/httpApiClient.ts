/**
 * The FastAPI-backed `ApiClient` implementation (issue #35). Every method is
 * typed from `@/shared/api/schema.gen`, indexed by path and method — the
 * operation ids are FastAPI's long defaults, so indexing this way keeps the
 * types readable. No generated client and no new runtime dependency.
 */
import type { paths } from "@/shared/api/schema.gen";
import { ApiError } from "@/types";
import type { ApiClient } from "../ApiClient";
import { request as baseRequest, type RequestOptions } from "./client";
import type { ProfileId } from "../profiles";
import {
  archiveListToDomain,
  conversationToDomain,
  archiveQueryToWire,
  taskDraftToDomain,
  settingsPatchToWire,
  settingsToDomain,
  taskDraftToWire,
  taskMoveToWire,
  taskPatchToWire,
  taskReorderToWire,
  taskToDomain,
} from "./mappers";

type AccessResponse =
  paths["/api/v1/auth/session"]["get"]["responses"][200]["content"]["application/json"];
type LoginRequest =
  paths["/api/v1/auth/login"]["post"]["requestBody"]["content"]["application/json"];
type SettingsResponse =
  paths["/api/v1/settings"]["get"]["responses"][200]["content"]["application/json"];
type TaskListResponse =
  paths["/api/v1/tasks"]["get"]["responses"][200]["content"]["application/json"];
type TaskResponse =
  paths["/api/v1/tasks/{task_id}"]["get"]["responses"][200]["content"]["application/json"];
type MoveResponse =
  paths["/api/v1/tasks/{task_id}/move"]["post"]["responses"][200]["content"]["application/json"];
type ReorderResponse =
  paths["/api/v1/tasks/reorder"]["post"]["responses"][200]["content"]["application/json"];
type ArchiveListResponse =
  paths["/api/v1/archive"]["get"]["responses"][200]["content"]["application/json"];
type ArchivedTaskResponse =
  paths["/api/v1/archive/{task_id}"]["get"]["responses"][200]["content"]["application/json"];
type ParseTaskRequest =
  paths["/api/v1/ai/parse-task"]["post"]["requestBody"]["content"]["application/json"];
type ParseTaskResponse =
  paths["/api/v1/ai/parse-task"]["post"]["responses"][200]["content"]["application/json"];
type ConversationResponse =
  paths["/api/v1/chat/conversation"]["get"]["responses"][200]["content"]["application/json"];
type SendMessageRequest =
  paths["/api/v1/chat/messages"]["post"]["requestBody"]["content"]["application/json"];
type RestoreResponse =
  paths["/api/v1/archive/{task_id}/restore"]["post"]["responses"][200]["content"]["application/json"];

export function createHttpApiClient(profile: ProfileId | null): ApiClient {
  const request = <T>(options: RequestOptions) => baseRequest<T>({ ...options, profile });
  return {
    async getAccess() {
      return baseRequest<AccessResponse>({ method: "GET", path: "/auth/session" });
    },
    async unlock(password) {
      const body: LoginRequest = { password };
      await baseRequest<unknown>({ method: "POST", path: "/auth/login", body });
    },
    async lock() {
      await baseRequest<void>({ method: "POST", path: "/auth/logout" });
    },
    async getProfiles() {
      return baseRequest({ method: "GET", path: "/profiles" });
    },
    async getSettings() {
      const wire = await request<SettingsResponse>({ method: "GET", path: "/settings" });
      return settingsToDomain(wire);
    },
    async updateSettings(patch) {
      const wire = await request<SettingsResponse>({
        method: "PATCH",
        path: "/settings",
        body: settingsPatchToWire(patch),
      });
      return settingsToDomain(wire);
    },
    async listTasks() {
      const wire = await request<TaskListResponse>({ method: "GET", path: "/tasks" });
      return wire.map(taskToDomain);
    },
    async getTask(id) {
      const wire = await request<TaskResponse>({
        method: "GET",
        path: `/tasks/${encodeURIComponent(id)}`,
      });
      return taskToDomain(wire);
    },
    async createTask(draft) {
      const wire = await request<TaskResponse>({
        method: "POST",
        path: "/tasks",
        body: taskDraftToWire(draft),
      });
      return taskToDomain(wire);
    },
    async updateTask(id, patch) {
      const wire = await request<TaskResponse>({
        method: "PATCH",
        path: `/tasks/${encodeURIComponent(id)}`,
        body: taskPatchToWire(patch),
      });
      return taskToDomain(wire);
    },
    async deleteTask(id) {
      await request<void>({ method: "DELETE", path: `/tasks/${encodeURIComponent(id)}` });
    },
    async moveTask(id, status, position) {
      const wire = await request<MoveResponse>({
        method: "POST",
        path: `/tasks/${encodeURIComponent(id)}/move`,
        body: taskMoveToWire(status, position),
      });
      return wire.map(taskToDomain);
    },
    async reorderTasks(status, orderedIds) {
      const wire = await request<ReorderResponse>({
        method: "POST",
        path: "/tasks/reorder",
        body: taskReorderToWire(status, orderedIds),
      });
      return wire.map(taskToDomain);
    },

    async parseTaskText(text, signal) {
      const body: ParseTaskRequest = { text };
      const wire = await request<ParseTaskResponse>({
        method: "POST",
        path: "/ai/parse-task",
        body,
        signal,
      });
      return taskDraftToDomain(wire);
    },

    async listArchive(search = "", page = 1) {
      const wire = await request<ArchiveListResponse>({
        method: "GET",
        path: "/archive",
        query: archiveQueryToWire(search, page),
      });
      return archiveListToDomain(wire);
    },
    async getArchivedTask(id) {
      const wire = await request<ArchivedTaskResponse>({
        method: "GET",
        path: `/archive/${encodeURIComponent(id)}`,
      });
      return taskToDomain(wire);
    },
    async restoreTask(id) {
      const wire = await request<RestoreResponse>({
        method: "POST",
        path: `/archive/${encodeURIComponent(id)}/restore`,
      });
      return taskToDomain(wire);
    },
    async permanentlyDeleteTask(id) {
      await request<void>({ method: "DELETE", path: `/archive/${encodeURIComponent(id)}` });
    },

    async getCurrentConversation() {
      const wire = await request<ConversationResponse>({
        method: "GET",
        path: "/chat/conversation",
      });
      return conversationToDomain(wire);
    },
    async startNewConversation() {
      const wire = await request<ConversationResponse>({
        method: "POST",
        path: "/chat/conversation",
      });
      return conversationToDomain(wire);
    },
    async sendChatMessage(text, signal) {
      const body: SendMessageRequest = { text };
      const wire = await request<ConversationResponse>({
        method: "POST",
        path: "/chat/messages",
        body,
        signal,
      });
      return conversationToDomain(wire);
    },
    async confirmChatAction(id) {
      const wire = await request<ConversationResponse>({
        method: "POST",
        path: `/chat/actions/${encodeURIComponent(id)}/confirm`,
      });
      return conversationToDomain(wire);
    },
    async rejectChatAction(id) {
      const wire = await request<ConversationResponse>({
        method: "POST",
        path: `/chat/actions/${encodeURIComponent(id)}/reject`,
      });
      return conversationToDomain(wire);
    },

    resetDemoData: () =>
      Promise.reject(new ApiError("NOT_SUPPORTED", "Demo data can't be reset on a live server.")),
  };
}
export const httpApiClient = createHttpApiClient(null);
