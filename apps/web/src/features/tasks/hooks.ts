import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { qk } from "@/shared/queryKeys";
import type { TaskDraft, TaskStatus } from "@/types";

export const useTasks = () => useQuery({ queryKey: qk.tasks, queryFn: () => api.listTasks() });

export const useArchive = (search: string, page = 1) =>
  useQuery({ queryKey: qk.archive(search, page), queryFn: () => api.listArchive(search, page) });

/**
 * Archive pages are filtered and paginated, so they cannot be the authority
 * for an open detail sheet. Keep the task query keyed solely by its ID while
 * retaining the archive prefix for the normal mutation invalidation lifecycle.
 */
export const useArchivedTask = (id: string | null) =>
  useQuery({
    queryKey: qk.archivedTask(id ?? ""),
    queryFn: () => api.getArchivedTask(id!),
    enabled: id !== null,
    retry: false,
  });

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
