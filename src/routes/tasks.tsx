import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { Loader2, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { SortableTaskCard, TaskCardContent } from "@/components/TaskCard";
import { TaskDetailSheet } from "@/components/TaskDetailSheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import { useSettings, useTasks, useTaskMutations } from "@/hooks/useApi";
import { getDeadlineState } from "@/lib/deadline";
import type { Task, TaskCategory, TaskPriority, TaskStatus } from "@/types";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Active tasks — Planora" },
      {
        name: "description",
        content:
          "Drag tasks across To do, In progress and Done, filter by category, priority or deadline, and keep today's plan in view.",
      },
      { property: "og:title", content: "Active tasks — Planora" },
      {
        property: "og:description",
        content: "A colourful drag-and-drop board for everything you're working on.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TasksPage,
});

const columns: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

function Column({
  status,
  label,
  tasks,
  timezone,
  onOpen,
}: {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  timezone: string;
  onOpen: (task: Task) => void;
}) {
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
        className={`flex min-h-32 flex-1 flex-col gap-3 rounded-xl p-1 transition-colors ${
          isOver ? "bg-primary/5 ring-2 ring-primary/30" : ""
        }`}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
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
}

function TasksPage() {
  useAuthGuard();
  const { data: settings } = useSettings();
  const { data: tasks, isLoading, isError, refetch, isFetching } = useTasks();
  const { move, reorder } = useTaskMutations();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<TaskCategory | "all">("all");
  const [priority, setPriority] = useState<TaskPriority | "all">("all");
  const [deadline, setDeadline] = useState<"all" | "due_soon" | "overdue" | "none">("all");
  const [active, setActive] = useState<Task | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);

  const timezone = settings?.timezone ?? "UTC";

  const filtered = useMemo(() => {
    const list = tasks ?? [];
    return list.filter((t) => {
      if (search && !`${t.title} ${t.content}`.toLowerCase().includes(search.toLowerCase()))
        return false;
      if (category !== "all" && t.category !== category) return false;
      if (priority !== "all" && t.priority !== priority) return false;
      if (deadline !== "all" && getDeadlineState(t) !== deadline) return false;
      return true;
    });
  }, [tasks, search, category, priority, deadline]);

  const byStatus = (status: TaskStatus) =>
    filtered.filter((t) => t.status === status).sort((a, b) => a.position - b.position);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (event: DragStartEvent) => {
    setActive((tasks ?? []).find((t) => t.id === event.active.id) ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const dragged = active;
    setActive(null);
    const over = event.over;
    if (!dragged || !over) return;

    const overId = String(over.id);
    let targetStatus: TaskStatus = dragged.status;
    let position = 0;

    if (overId.startsWith("column:")) {
      targetStatus = overId.slice("column:".length) as TaskStatus;
      position = byStatus(targetStatus).length;
    } else {
      const overTask = (tasks ?? []).find((t) => t.id === overId);
      if (!overTask) return;
      targetStatus = overTask.status;
      const column = byStatus(targetStatus);
      position = column.findIndex((t) => t.id === overTask.id);
      if (position < 0) position = column.length;
    }

    if (targetStatus === dragged.status) {
      const column = byStatus(targetStatus);
      const from = column.findIndex((t) => t.id === dragged.id);
      if (from === position || from < 0) return;
      const next = [...column];
      const [item] = next.splice(from, 1);
      if (item) next.splice(position, 0, item);
      reorder.mutate(
        { status: targetStatus, orderedIds: next.map((t) => t.id) },
        { onError: () => toast.error("Couldn't reorder that task") },
      );
    } else {
      move.mutate(
        { id: dragged.id, status: targetStatus, position },
        {
          onSuccess: () => toast.success("Task moved"),
          onError: () => toast.error("Couldn't move that task"),
        },
      );
    }
  };

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-7xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Active tasks</h1>
            <p className="text-sm text-muted-foreground">
              Drag cards between columns to update their status.
            </p>
          </div>
          {isFetching && !isLoading && (
            <Loader2
              className="h-4 w-4 animate-spin text-muted-foreground"
              aria-label="Refreshing"
            />
          )}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-card">
          <div className="relative min-w-52 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks"
              aria-label="Search tasks"
              className="pl-9"
            />
          </div>
          <SlidersHorizontal
            className="hidden h-4 w-4 text-muted-foreground sm:block"
            aria-hidden
          />
          <Select value={category} onValueChange={(v) => setCategory(v as TaskCategory | "all")}>
            <SelectTrigger className="w-36" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="work">Work</SelectItem>
              <SelectItem value="personal">Personal</SelectItem>
              <SelectItem value="study">Study</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority | "all")}>
            <SelectTrigger className="w-36" aria-label="Filter by priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={deadline} onValueChange={(v) => setDeadline(v as typeof deadline)}>
            <SelectTrigger className="w-36" aria-label="Filter by deadline">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any deadline</SelectItem>
              <SelectItem value="due_soon">Due within 24h</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="none">No deadline</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading && (
          <div className="grid gap-4 md:grid-cols-3">
            {columns.map((c) => (
              <div key={c.status} className="space-y-3 rounded-2xl bg-secondary/50 p-3">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-28 w-full rounded-xl" />
                <Skeleton className="h-28 w-full rounded-xl" />
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">We couldn't load your tasks.</p>
            <Button className="mt-3 min-h-11" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        )}

        {!isLoading && !isError && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActive(null)}
          >
            <div className="grid gap-4 md:grid-cols-3">
              {columns.map((c) => (
                <Column
                  key={c.status}
                  status={c.status}
                  label={c.label}
                  tasks={byStatus(c.status)}
                  timezone={timezone}
                  onOpen={setSelected}
                />
              ))}
            </div>
            <DragOverlay>
              {active ? <TaskCardContent task={active} timezone={timezone} dragging /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <TaskDetailSheet task={selected} timezone={timezone} onClose={() => setSelected(null)} />
    </AppShell>
  );
}
