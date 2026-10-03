import { memo, useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableTaskCard } from "@/features/tasks/components/TaskCard";
import type { Task, TaskStatus } from "@/types";

type Props = {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  timezone: string;
  onOpen: (task: Task) => void;
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
    <section className="flex min-w-0 flex-col rounded-2xl bg-secondary/50 p-3">
      <header className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold tracking-tight">{label}</h2>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
          {tasks.length}
        </span>
      </header>
      <div
        ref={setNodeRef}
        className={`flex min-h-32 flex-1 flex-col gap-3 rounded-xl p-1 transition-colors ${isOver ? "bg-primary/5 ring-2 ring-primary/30" : ""}`}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} timezone={timezone} onOpen={onOpen} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nothing here yet.</p>
        )}
      </div>
    </section>
  );
});
