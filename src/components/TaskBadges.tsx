import { AlertTriangle, CalendarClock, CalendarOff, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { deadlineLabels } from "@/lib/deadline";
import type { DeadlineState, TaskCategory, TaskPriority } from "@/types";

const categoryClass: Record<TaskCategory, string> = {
  work: "bg-cat-work text-cat-work-foreground",
  personal: "bg-cat-personal text-cat-personal-foreground",
  study: "bg-cat-study text-cat-study-foreground",
  other: "bg-cat-other text-cat-other-foreground",
};

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

const priorityClass: Record<TaskPriority, string> = {
  low: "border border-border bg-muted text-muted-foreground",
  medium: "border border-primary/30 bg-secondary text-secondary-foreground",
  high: "bg-primary text-primary-foreground",
};

const chip = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium";

export function CategoryBadge({ category }: { category: TaskCategory }) {
  return <span className={cn(chip, categoryClass[category])}>{categoryLabels[category]}</span>;
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span className={cn(chip, priorityClass[priority])}>{priorityLabels[priority]} priority</span>
  );
}

const deadlineIcon = {
  none: CalendarOff,
  scheduled: CalendarClock,
  due_soon: Clock,
  overdue: AlertTriangle,
};

const deadlineClass: Record<DeadlineState, string> = {
  none: "bg-muted text-muted-foreground",
  scheduled: "bg-secondary text-secondary-foreground",
  due_soon: "bg-warning/25 text-warning-foreground",
  overdue: "bg-destructive/15 text-destructive",
};

export function DeadlineBadge({ state, text }: { state: DeadlineState; text?: string | undefined }) {
  const Icon = deadlineIcon[state];
  return (
    <span className={cn(chip, deadlineClass[state])}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {deadlineLabels[state]}
      {text ? <span className="font-normal opacity-80">· {text}</span> : null}
    </span>
  );
}
