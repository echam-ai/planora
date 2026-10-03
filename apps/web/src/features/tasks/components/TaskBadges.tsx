import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CalendarOff,
  CheckCircle2,
  Clock,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { deadlineLabels } from "@/features/tasks/deadline";
import { categoryLabels, priorityLabels } from "@/features/tasks/labels";
import type { DeadlineState, TaskCategory, TaskPriority } from "@/types";

const categoryClass: Record<TaskCategory, string> = {
  work: "bg-cat-work text-cat-work-foreground",
  personal: "bg-cat-personal text-cat-personal-foreground",
  study: "bg-cat-study text-cat-study-foreground",
  other: "bg-cat-other text-cat-other-foreground",
};

const priorityClass: Record<TaskPriority, string> = {
  low: "border border-border bg-muted text-muted-foreground",
  medium: "border border-primary/30 bg-secondary text-secondary-foreground",
  high: "border border-transparent bg-primary text-primary-foreground",
};

const priorityIcon = { low: ArrowDown, medium: Minus, high: ArrowUp };

const chip = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium";

export function CategoryBadge({ category }: { category: TaskCategory }) {
  return <span className={cn(chip, categoryClass[category])}>{categoryLabels[category]}</span>;
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const Icon = priorityIcon[priority];
  return (
    <span className={cn(chip, priorityClass[priority])}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {priorityLabels[priority]} priority
    </span>
  );
}

const deadlineIcon = {
  none: CalendarOff,
  scheduled: CalendarClock,
  due_soon: Clock,
  overdue: AlertTriangle,
  completed: CheckCircle2,
};

const deadlineClass: Record<DeadlineState, string> = {
  none: "bg-muted text-muted-foreground",
  scheduled: "bg-secondary text-secondary-foreground",
  due_soon: "bg-warning/25 text-warning-foreground",
  overdue: "bg-destructive/15 text-destructive",
  completed: "bg-success/20 text-success-foreground",
};

export function DeadlineBadge({
  state,
  text,
}: {
  state: DeadlineState;
  text?: string | undefined;
}) {
  const Icon = deadlineIcon[state];
  return (
    <span className={cn(chip, deadlineClass[state])}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {deadlineLabels[state]}
      {text ? <span className="font-normal opacity-80">· {text}</span> : null}
    </span>
  );
}
