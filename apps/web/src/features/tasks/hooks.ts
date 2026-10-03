import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { captureApi } from "@/services/api";
import { qk } from "@/shared/queryKeys";
import type { Task, TaskDraft, TaskStatus } from "@/types";

export function useTasks() {
  const api = captureApi();
  return useQuery({ queryKey: qk.tasks, queryFn: () => api.listTasks() });
}

export function useArchive(search: string, page = 1) {
  const api = captureApi();
  return useQuery({
    queryKey: qk.archive(search, page),
    queryFn: () => api.listArchive(search, page),
  });
}

/**
 * Archive pages are filtered and paginated, so they cannot be the authority
 * for an open detail sheet. Keep the task query keyed solely by its ID while
 * retaining the archive prefix for the normal mutation invalidation lifecycle.
 */
export function useArchivedTask(id: string | null) {
  const api = captureApi();
  return useQuery({
    queryKey: qk.archivedTask(id ?? ""),
    queryFn: () => api.getArchivedTask(id!),
    enabled: id !== null,
    retry: false,
  });
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const api = captureApi();
  const invalidateTasks = () => qc.invalidateQueries({ queryKey: qk.tasks });
  // move/reorder already return the full ordered active task list.
  const setTasks = (tasks: Task[]) => qc.setQueryData(qk.tasks, tasks);
  // Only restore and purge change what the archive holds.
  const invalidateArchive = () => qc.invalidateQueries({ queryKey: qk.archiveAll });

  return {
    create: useMutation({
      mutationFn: (draft: TaskDraft) => api.createTask(draft),
      onSuccess: invalidateTasks,
    }),
    update: useMutation({
      mutationFn: ({
        id,
        patch,
      }: {
        id: string;
        patch: Partial<TaskDraft> & { status?: TaskStatus };
      }) => api.updateTask(id, patch),
      onSuccess: invalidateTasks,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.deleteTask(id),
      onSuccess: invalidateTasks,
    }),
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
      onSuccess: setTasks,
    }),
    reorder: useMutation({
      mutationFn: ({ status, orderedIds }: { status: TaskStatus; orderedIds: string[] }) =>
        api.reorderTasks(status, orderedIds),
      onSuccess: setTasks,
    }),
    restore: useMutation({
      mutationFn: (id: string) => api.restoreTask(id),
      onSuccess: () => {
        invalidateTasks();
        invalidateArchive();
      },
    }),
    purge: useMutation({
      mutationFn: (id: string) => api.permanentlyDeleteTask(id),
      onSuccess: invalidateArchive,
    }),
  };
}
