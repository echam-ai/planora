import { useEffect, useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TaskForm } from "@/features/tasks/components/TaskForm";
import { categoryLabels, priorityLabels } from "@/features/tasks/labels";
import { MarkdownPreview } from "@/lib/markdown";
import { formatInZone, getDeadlineState } from "@/features/tasks/deadline";
import {
  CategoryBadge,
  DeadlineBadge,
  PriorityBadge,
} from "@/features/tasks/components/TaskBadges";
import { useTaskMutations } from "@/features/tasks/hooks";
import type { Task, TaskDraft, TaskStatus } from "@/types";

function TaskLinks({ urls }: { urls: Task["urls"] }) {
  if (urls.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm">
      {urls.map((u) => (
        <li key={u.id}>
          <a
            className="inline-flex items-center gap-1 text-primary underline"
            href={u.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {u.label || u.url} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </li>
      ))}
    </ul>
  );
}

function LoadError({
  verb,
  error,
  onRetry,
}: {
  verb: "load" | "refresh";
  error: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <div className="space-y-3" role="alert">
      <p className="text-sm text-destructive">
        Couldn't {verb} this archived task: {error}
      </p>
      {onRetry && (
        <Button type="button" variant="outline" className="min-h-11" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function TaskDetailSheet({
  task,
  timezone,
  readOnly = false,
  onClose,
  open = !!task,
  loading = false,
  error,
  onRetry,
}: {
  task: Task | null;
  timezone: string;
  readOnly?: boolean;
  onClose: () => void;
  open?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const { update, remove } = useTaskMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The status the user picked in this sheet, per task. Everything else about
  // status comes from the task itself so the control never shows stale state.
  const [statusEdit, setStatusEdit] = useState<{ id: string; status: TaskStatus } | null>(null);

  useEffect(() => {
    if (!task) setStatusEdit(null);
  }, [task]);

  if (!task) {
    if (!open) return null;
    return (
      <Sheet open onOpenChange={(value) => !value && onClose()}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="pr-12">
            <SheetTitle className="text-left">Archived task</SheetTitle>
            <SheetDescription className="text-left">Archived task (read only)</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-8">
            {loading && <p className="text-sm text-muted-foreground">Loading archived task…</p>}
            {error && <LoadError verb="load" error={error} onRetry={onRetry} />}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const userStatus = statusEdit && statusEdit.id === task.id ? statusEdit.status : null;
  const status = userStatus ?? task.status;

  const save = (_draft: TaskDraft, patch: Partial<TaskDraft>) => {
    const changed: Partial<TaskDraft> & { status?: TaskStatus } =
      userStatus !== null && userStatus !== task.status ? { ...patch, status: userStatus } : patch;
    if (Object.keys(changed).length === 0) {
      toast.info("No changes to save");
      return;
    }
    update.mutate(
      { id: task.id, patch: changed },
      {
        onSuccess: () => {
          toast.success("Task saved");
          onClose();
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  return (
    <Sheet open={!!task} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pr-12">
          <SheetTitle className="text-left">{task.title}</SheetTitle>
          <SheetDescription className="text-left">
            {readOnly ? "Archived task (read only)" : "Edit any field and save your changes."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-8">
          {error && <LoadError verb="refresh" error={error} onRetry={onRetry} />}
          {readOnly ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <CategoryBadge category={task.category} />
                <PriorityBadge priority={task.priority} />
                <DeadlineBadge state={getDeadlineState(task)} />
              </div>
              <p className="whitespace-pre-wrap text-sm">{task.content}</p>
              <dl className="grid gap-2 text-sm">
                <div className="flex gap-2">
                  <dt className="w-28 text-muted-foreground">Category</dt>
                  <dd>{categoryLabels[task.category]}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 text-muted-foreground">Priority</dt>
                  <dd>{priorityLabels[task.priority]}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 text-muted-foreground">Deadline</dt>
                  <dd>{formatInZone(task.deadlineAt, timezone)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 text-muted-foreground">Completed</dt>
                  <dd>{formatInZone(task.completedAt, timezone)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-28 text-muted-foreground">Archived</dt>
                  <dd>{formatInZone(task.archivedAt, timezone)}</dd>
                </div>
              </dl>
              <TaskLinks urls={task.urls} />
              <div className="rounded-lg border border-border bg-card p-4">
                <MarkdownPreview source={task.markdownNote} />
              </div>
            </div>
          ) : (
            <>
              <DeadlineBadge state={getDeadlineState(task)} />
              <TaskLinks urls={task.urls} />

              <TaskForm
                key={task.id}
                defaultDraft={task}
                submitLabel="Save changes"
                submitting={update.isPending}
                onSubmit={save}
                onCancel={onClose}
                status={status}
                onStatusChange={(next) => setStatusEdit({ id: task.id, status: next })}
                extraActions={
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                }
              />

              <dl className="grid gap-1 border-t border-border pt-4 text-xs text-muted-foreground">
                <div className="flex gap-2">
                  <dt className="w-24">Created</dt>
                  <dd>{formatInZone(task.createdAt, timezone)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-24">Updated</dt>
                  <dd>{formatInZone(task.updatedAt, timezone)}</dd>
                </div>
                {task.completedAt && (
                  <div className="flex gap-2">
                    <dt className="w-24">Completed</dt>
                    <dd>{formatInZone(task.completedAt, timezone)}</dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </div>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{task.title}”?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the task from your board. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep task</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  remove.mutate(task.id, {
                    onSuccess: () => {
                      toast.success("Task deleted");
                      onClose();
                    },
                    onError: (e: Error) => toast.error(e.message),
                  })
                }
              >
                Delete task
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
