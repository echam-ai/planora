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

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timezone: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${timezone}|${withTime}`;
  let formatter = zoneFormatters.get(key);
  if (!formatter) {
    // Newer ICU spells September "Sept" in en-GB; the API's format is "Sep".
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
    });
    zoneFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatInZone(iso: string | null, timezone: string, withTime = true) {
  if (!iso) return "—";
  try {
    return zoneFormatter(timezone, withTime)
      .format(new Date(iso))
      .replace(/\bSept\b/, "Sep");
  } catch {
    return new Date(iso).toLocaleString();
  }
}
