import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { AppSettings, TaskDraft, TaskStatus } from "@/types";

export const qk = {
  session: ["session"] as const,
  settings: ["settings"] as const,
  tasks: ["tasks"] as const,
  archive: (search: string, page: number) => ["archive", search, page] as const,
  conversation: ["conversation"] as const,
};

export const useSession = () =>
  useQuery({ queryKey: qk.session, queryFn: () => api.getSession(), staleTime: 60_000 });

export const useSettings = () =>
  useQuery({ queryKey: qk.settings, queryFn: () => api.getSettings() });

export const useTasks = () => useQuery({ queryKey: qk.tasks, queryFn: () => api.listTasks() });

export const useArchive = (search: string, page = 1) =>
  useQuery({ queryKey: qk.archive(search, page), queryFn: () => api.listArchive(search, page) });

export const useConversation = () =>
  useQuery({ queryKey: qk.conversation, queryFn: () => api.getCurrentConversation() });

export function useTaskMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: qk.tasks });
    qc.invalidateQueries({ queryKey: ["archive"] });
  };

  return {
    create: useMutation({
      mutationFn: (draft: TaskDraft) => api.createTask(draft),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        patch,
      }: {
        id: string;
        patch: Partial<TaskDraft> & { status?: TaskStatus };
      }) => api.updateTask(id, patch),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.deleteTask(id), onSuccess: invalidate }),
    move: useMutation({
      mutationFn: ({
        id,
        status,
        position,
      }: {
        id: string;
        status: TaskStatus;
        position: number;
      }) => api.moveTask(id, status, position),
      onSuccess: invalidate,
    }),
    reorder: useMutation({
      mutationFn: ({ status, orderedIds }: { status: TaskStatus; orderedIds: string[] }) =>
        api.reorderTasks(status, orderedIds),
      onSuccess: invalidate,
    }),
    restore: useMutation({
      mutationFn: (id: string) => api.restoreTask(id),
      onSuccess: invalidate,
    }),
    purge: useMutation({
      mutationFn: (id: string) => api.permanentlyDeleteTask(id),
      onSuccess: invalidate,
    }),
  };
}

export function useSettingsMutations() {
  const qc = useQueryClient();
  return {
    save: useMutation({
      mutationFn: (patch: Partial<AppSettings>) => api.updateSettings(patch),
      onSuccess: (s) => qc.setQueryData(qk.settings, s),
    }),
    changePassword: useMutation({
      mutationFn: ({ current, next }: { current: string; next: string }) =>
        api.changePassword(current, next),
    }),
  };
}

export function useChatMutations() {
  const qc = useQueryClient();
  const sync = (conv: unknown) => {
    qc.setQueryData(qk.conversation, conv);
    qc.invalidateQueries({ queryKey: qk.tasks });
  };
  return {
    send: useMutation({ mutationFn: (text: string) => api.sendChatMessage(text), onSuccess: sync }),
    reset: useMutation({ mutationFn: () => api.startNewConversation(), onSuccess: sync }),
    confirm: useMutation({
      mutationFn: (actionId: string) => api.confirmChatAction(actionId),
      onSuccess: sync,
    }),
    reject: useMutation({
      mutationFn: (actionId: string) => api.rejectChatAction(actionId),
      onSuccess: sync,
    }),
  };
}
