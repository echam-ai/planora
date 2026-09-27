import type { DeadlineState, Task } from "@/types";

export function getDeadlineState(task: Task, now = new Date()): DeadlineState {
  if (task.status === "done") return "completed";
  if (!task.deadlineAt) return "none";
  const deadline = new Date(task.deadlineAt).getTime();
  const diff = deadline - now.getTime();
  if (diff < 0) return "overdue";
  if (diff <= 24 * 60 * 60 * 1000) return "due_soon";
  return "scheduled";
}

export const deadlineLabels: Record<DeadlineState, string> = {
  none: "No deadline",
  scheduled: "Scheduled",
  due_soon: "Near deadline",
  overdue: "Overdue",
  completed: "Completed",
};

export function formatInZone(iso: string | null, timezone: string, withTime = true) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}
