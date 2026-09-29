import type { TaskCategory, TaskPriority } from "@/types";

export const categoryLabels: Record<TaskCategory, string> = {
  work: "Work",
  personal: "Personal",
  study: "Study",
  other: "Other",
};

export const priorityLabels: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
