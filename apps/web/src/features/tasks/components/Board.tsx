import { useCallback, useMemo, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CloudOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/layout/StatePanel";
import { BoardColumn } from "@/features/tasks/components/BoardColumn";
import { BoardFilters } from "@/features/tasks/components/BoardFilters";
import {
  emptyBoardFilters,
  filterTasks,
  type BoardFiltersState,
} from "@/features/tasks/boardFilters";
import { TaskCardContent } from "@/features/tasks/components/TaskCard";
import { TaskDetailSheet } from "@/features/tasks/components/TaskDetailSheet";
import { useTaskMutations, useTasks } from "@/features/tasks/hooks";
import { useSettings } from "@/features/settings/hooks";
import type { Task, TaskStatus } from "@/types";

const columns: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

export function Board() {
  const { data: settings } = useSettings();
  const { data: tasks, isLoading, isError, refetch, isFetching } = useTasks();
  const { move, reorder } = useTaskMutations();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<BoardFiltersState>(emptyBoardFilters);
  const [active, setActive] = useState<Task | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = (tasks ?? []).find((task) => task.id === selectedId) ?? null;
  const timezone = settings?.timezone ?? "UTC";
  const filtered = useMemo(
    () => filterTasks(tasks ?? [], search, filters),
    [tasks, search, filters],
  );
  const grouped = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], done: [] };
    for (const task of filtered) groups[task.status].push(task);
    for (const group of Object.values(groups)) group.sort((a, b) => a.position - b.position);
    return groups;
  }, [filtered]);
  const byStatus = (status: TaskStatus) => grouped[status];
  const total = tasks?.length ?? 0;
  const doneCount = (tasks ?? []).filter((task) => task.status === "done").length;
  const filtering = filtered.length !== total;
  const openTask = useCallback((task: Task) => setSelectedId(task.id), []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (event: DragStartEvent) =>
    setActive((tasks ?? []).find((task) => task.id === event.active.id) ?? null);
  const onDragEnd = (event: DragEndEvent) => {
    const dragged = active;
    setActive(null);
    if (!dragged || !event.over) return;
    const overId = String(event.over.id);
    let targetStatus: TaskStatus = dragged.status;
    let position = 0;
    if (overId.startsWith("column:")) {
      targetStatus = overId.slice("column:".length) as TaskStatus;
      position = byStatus(targetStatus).length;
    } else {
      const overTask = (tasks ?? []).find((task) => task.id === overId);
      if (!overTask) return;
      targetStatus = overTask.status;
      const column = byStatus(targetStatus);
      position = column.findIndex((task) => task.id === overTask.id);
      if (position < 0) position = column.length;
    }
    if (targetStatus === dragged.status) {
      const column = byStatus(targetStatus);
      const from = column.findIndex((task) => task.id === dragged.id);
      if (from === position || from < 0) return;
      const next = [...column];
      const [item] = next.splice(from, 1);
      if (item) next.splice(position, 0, item);
      reorder.mutate(
        { status: targetStatus, orderedIds: next.map((task) => task.id) },
        { onError: () => toast.error("Couldn't reorder that task") },
      );
      return;
    }
    move.mutate(
      { id: dragged.id, status: targetStatus, position },
      {
        onSuccess: () => toast.success("Task moved"),
        onError: () => toast.error("Couldn't move that task"),
      },
    );
  };

  return (
    <>
      <div className="mx-auto w-full max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Active tasks</h1>
            <p className="mt-1 text-muted-foreground">
              Drag cards between columns to update their status.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isFetching && !isLoading && (
              <Loader2
                className="h-4 w-4 animate-spin text-muted-foreground"
                aria-label="Refreshing"
              />
            )}
            {tasks && (
              <p
                className="rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground shadow-card"
                data-testid="board-summary"
              >
                {filtering
                  ? `Showing ${filtered.length} of ${total} ${total === 1 ? "task" : "tasks"}`
                  : `${total} ${total === 1 ? "task" : "tasks"} · ${doneCount} done`}
              </p>
            )}
          </div>
        </div>
        <BoardFilters
          search={search}
          filters={filters}
          onSearchChange={setSearch}
          onFiltersChange={setFilters}
        />
        {isLoading && (
          <div className="grid gap-4 md:grid-cols-3">
            {columns.map((column) => (
              <div
                key={column.status}
                className="space-y-3 rounded-3xl border border-border bg-lane p-3"
              >
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-28 w-full rounded-2xl" />
                <Skeleton className="h-28 w-full rounded-2xl" />
              </div>
            ))}
          </div>
        )}
        {isError && (
          <StatePanel
            icon={CloudOff}
            tone="error"
            action={
              <Button className="min-h-11" variant="outline" onClick={() => refetch()}>
                Try again
              </Button>
            }
          >
            We couldn't load your tasks.
          </StatePanel>
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
              {columns.map((column) => (
                <BoardColumn
                  key={column.status}
                  {...column}
                  tasks={byStatus(column.status)}
                  timezone={timezone}
                  onOpen={openTask}
                />
              ))}
            </div>
            <DragOverlay>
              {active ? <TaskCardContent task={active} timezone={timezone} dragging /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      <TaskDetailSheet task={selected} timezone={timezone} onClose={() => setSelectedId(null)} />
    </>
  );
}
