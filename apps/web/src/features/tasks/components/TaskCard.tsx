import { GripVertical, Link2, StickyNote } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { formatInZone, getDeadlineState } from "@/features/tasks/deadline";
import {
  CategoryBadge,
  DeadlineBadge,
  PriorityBadge,
} from "@/features/tasks/components/TaskBadges";
import type { Task } from "@/types";

export function TaskCardContent({
  task,
  timezone,
  dragging,
}: {
  task: Task;
  timezone: string;
  dragging?: boolean;
}) {
  const state = getDeadlineState(task);
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-card transition-shadow",
        dragging && "rotate-1 shadow-lg",
      )}
    >
      <h3 className="text-sm font-semibold leading-snug text-card-foreground">{task.title}</h3>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{task.content}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <CategoryBadge category={task.category} />
        <PriorityBadge priority={task.priority} />
        <DeadlineBadge
          state={state}
          text={task.deadlineAt ? formatInZone(task.deadlineAt, timezone) : undefined}
        />
      </div>
      {(task.urls.length > 0 || task.markdownNote.trim()) && (
        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          {task.urls.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Link2 className="h-3.5 w-3.5" aria-hidden />
              {task.urls.length} link{task.urls.length > 1 ? "s" : ""}
            </span>
          )}
          {task.markdownNote.trim() && (
            <span className="inline-flex items-center gap-1">
              <StickyNote className="h-3.5 w-3.5" aria-hidden />
              Note
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function SortableTaskCard({
  task,
  timezone,
  onOpen,
}: {
  task: Task;
  timezone: string;
  onOpen: (task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status: task.status },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "opacity-40")}
    >
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="w-full rounded-xl text-left focus-visible:outline-none"
        aria-label={`Open task ${task.title}`}
      >
        <TaskCardContent task={task} timezone={timezone} />
      </button>
      <button
        type="button"
        className="absolute right-2 top-2 flex h-11 w-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        aria-label={`Drag ${task.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
