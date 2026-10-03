import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArchiveRestore, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { taskCardDetailsId } from "@/features/tasks/cardIds";
import { TaskCardContent } from "@/features/tasks/components/TaskCard";
import { TaskDetailSheet } from "@/features/tasks/components/TaskDetailSheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DeleteTaskDialog } from "@/features/tasks/components/DeleteTaskDialog";
import { useArchive, useArchivedTask, useTaskMutations } from "@/features/tasks/hooks";
import { useSettings } from "@/features/settings/hooks";
import { useProfileGuard } from "@/hooks/useProfileGuard";
import { useAdoptDomValue } from "@/hooks/useAdoptDomValue";
import { ApiError, type Task } from "@/types";

const SEARCH_DEBOUNCE_MS = 250;

export const Route = createFileRoute("/archive")({
  head: () => ({
    meta: [
      { title: "Archive — Planora" },
      {
        name: "description",
        content: "Search finished tasks, restore anything you still need, or clear it for good.",
      },
      { property: "og:title", content: "Archive — Planora" },
      {
        property: "og:description",
        content: "Search finished tasks, restore anything you still need, or clear it for good.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ArchivePage,
});

function ArchivePage() {
  useProfileGuard();
  const [search, setSearch] = useState("");
  // The term and page the query uses. They change in one update, so the old
  // term is never requested at the new page.
  const [settled, setSettled] = useState({ term: "", page: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<Task | null>(null);
  const page = settled.page;
  const setPage = (update: (page: number) => number) =>
    setSettled((current) => ({ ...current, page: update(current.page) }));
  const searchRef = useAdoptDomValue<HTMLInputElement>(setSearch);

  useEffect(() => {
    if (search === settled.term) return;
    const timer = setTimeout(() => setSettled({ term: search, page: 1 }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, settled.term]);

  const { data: settings } = useSettings();
  const { data, isLoading, isError, isPlaceholderData, refetch } = useArchive(settled.term, page);
  const archivedTask = useArchivedTask(selectedId);
  const { restore } = useTaskMutations();
  // An archive page is only a filtered, paginated view. The detail query is
  // keyed by ID and is the authority for the open sheet.
  const selected = archivedTask.data ?? null;
  const timezone = settings?.timezone ?? "UTC";

  const notFound =
    archivedTask.error instanceof ApiError && archivedTask.error.code === "NOT_FOUND";

  useEffect(() => {
    if (selectedId && archivedTask.isError && notFound) {
      setSelectedId(null);
      toast.info("This task is no longer available in the archive.");
    }
  }, [archivedTask.isError, notFound, selectedId]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <h1 className="text-2xl font-semibold tracking-tight">Archive</h1>
        <p className="text-sm text-muted-foreground">Completed and archived tasks.</p>

        <div className="relative my-5">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search archived tasks"
            aria-label="Search archived tasks"
            className="pl-9"
          />
        </div>

        {isLoading && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-36 w-full rounded-xl" />
            <Skeleton className="h-36 w-full rounded-xl" />
          </div>
        )}

        {isError && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">We couldn't load the archive.</p>
            <Button className="mt-3 min-h-11" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        )}

        {data && data.items.length === 0 && !isLoading && !isPlaceholderData && (
          <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            {settled.term ? "No archived tasks match that search." : "Nothing archived yet."}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {data?.items.map((task) => (
            <div key={task.id} className="space-y-2">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setSelectedId(task.id)}
                aria-label={`Open archived task ${task.title}`}
                aria-describedby={taskCardDetailsId(task.id)}
              >
                <TaskCardContent
                  task={task}
                  timezone={timezone}
                  detailsId={taskCardDetailsId(task.id)}
                />
              </button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="min-h-11 flex-1"
                  onClick={() =>
                    restore.mutate(task.id, {
                      onSuccess: () => {
                        if (selectedId === task.id) setSelectedId(null);
                        toast.success("Task restored");
                      },
                      onError: () => toast.error("Couldn't restore that task"),
                    })
                  }
                >
                  <ArchiveRestore className="h-4 w-4" /> Restore
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11 text-destructive hover:text-destructive"
                  onClick={() => setPurgeTarget(task)}
                  aria-label={`Delete ${task.title} permanently`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {data && totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      <TaskDetailSheet
        task={selected}
        timezone={timezone}
        readOnly
        onClose={() => setSelectedId(null)}
        open={selectedId !== null}
        loading={archivedTask.isLoading && selected === null}
        error={archivedTask.isError && !notFound ? archivedTask.error.message : null}
        onRetry={() => archivedTask.refetch()}
      />

      {purgeTarget && (
        <DeleteTaskDialog
          task={purgeTarget}
          open
          onOpenChange={(open) => {
            if (!open) setPurgeTarget(null);
          }}
          onDeleted={() => {
            if (selectedId === purgeTarget.id) setSelectedId(null);
          }}
        />
      )}
    </AppShell>
  );
}
