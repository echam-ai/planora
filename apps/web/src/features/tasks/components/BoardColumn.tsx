import { memo, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Inbox } from "lucide-react";
import { StatePanel } from "@/components/layout/StatePanel";
import { SortableTaskCard } from "@/features/tasks/components/TaskCard";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/types";

type Props = {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  timezone: string;
  onOpen: (task: Task) => void;
};

/** The dot beside a column name. The name and the count carry the meaning; the dot is a cue. */
const statusDot: Record<TaskStatus, string> = {
  todo: "bg-muted-foreground",
  in_progress: "bg-primary",
  done: "bg-success",
};

export const BoardColumn = memo(function BoardColumn({
  status,
  label,
  tasks,
  timezone,
  onOpen,
}: Props) {
  const items = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });
  return (
    <section className="flex min-w-0 flex-col rounded-3xl border border-border bg-lane p-3 backdrop-blur-sm">
      <header className="mb-3 flex items-center gap-2 px-2 pt-1">
        <span aria-hidden="true" className={cn("size-2.5 rounded-full", statusDot[status])} />
        <h2 className="text-sm font-semibold tracking-tight">{label}</h2>
        <span className="ml-auto min-w-6 rounded-full bg-card px-2 py-0.5 text-center text-xs font-medium text-muted-foreground shadow-card">
          {tasks.length}
          <span className="sr-only"> {tasks.length === 1 ? "task" : "tasks"}</span>
        </span>
      </header>
      <div
        ref={setNodeRef}
        data-testid={`column-dropzone-${status}`}
        className={cn(
          "flex min-h-32 flex-1 flex-col gap-3 rounded-2xl p-1 transition-colors duration-150",
          isOver && "bg-primary/5 ring-2 ring-primary/30",
        )}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} timezone={timezone} onOpen={onOpen} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <StatePanel icon={Inbox} compact>
            Nothing here yet.
          </StatePanel>
        )}
      </div>
    </section>
  );
});
