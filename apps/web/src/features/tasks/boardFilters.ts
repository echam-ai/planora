import { getDeadlineState } from "@/features/tasks/deadline";
import type { Task, TaskCategory, TaskPriority } from "@/types";

export type BoardDeadlineFilter = "none" | "scheduled" | "due_soon" | "overdue";

export type BoardFiltersState = {
  categories: TaskCategory[];
  priorities: TaskPriority[];
  deadlines: BoardDeadlineFilter[];
};

export const emptyBoardFilters: BoardFiltersState = {
  categories: [],
  priorities: [],
  deadlines: [],
};

export function filterTasks(
  tasks: Task[],
  search: string,
  filters: BoardFiltersState,
  now = new Date(),
): Task[] {
  const query = search.toLowerCase();
  return tasks.filter((task) => {
    if (query && !`${task.title} ${task.content}`.toLowerCase().includes(query)) return false;
    if (filters.categories.length && !filters.categories.includes(task.category)) return false;
    if (filters.priorities.length && !filters.priorities.includes(task.priority)) return false;
    if (!filters.deadlines.length) return true;
    const deadlineState = getDeadlineState(task, now);
    return deadlineState !== "completed" && filters.deadlines.includes(deadlineState);
  });
}
