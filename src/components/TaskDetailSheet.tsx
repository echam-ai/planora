import { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
import { TaskForm } from "@/components/TaskForm";
import { MarkdownPreview } from "@/lib/markdown";
import { formatInZone } from "@/lib/deadline";
import { CategoryBadge, PriorityBadge, categoryLabels, priorityLabels } from "@/components/TaskBadges";
import { useTaskMutations } from "@/hooks/useApi";
import type { Task, TaskDraft, TaskStatus } from "@/types";

export function TaskDetailSheet({
  task,
  timezone,
  readOnly = false,
  onClose,
}: {
  task: Task | null;
  timezone: string;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const { update, remove } = useTaskMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");

  if (!task) return null;

  const save = (draft: TaskDraft) => {
    update.mutate(
      { id: task.id, patch: { ...draft, status } },
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
        <SheetHeader>
          <SheetTitle className="pr-6 text-left">{task.title}</SheetTitle>
          <SheetDescription className="text-left">
            {readOnly ? "Archived task (read only)" : "Edit any field and save your changes."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-8">
          {readOnly ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <CategoryBadge category={task.category} />
                <PriorityBadge priority={task.priority} />
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
              {task.urls.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {task.urls.map((u) => (
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
              )}
              <div className="rounded-lg border border-border bg-card p-4">
                <MarkdownPreview source={task.markdownNote} />
              </div>
            </div>
          ) : (
            <>
              {task.urls.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {task.urls.map((u) => (
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
              )}

              <TaskForm
                key={task.id}
                defaultDraft={task}
                submitLabel="Save changes"
                submitting={update.isPending}
                onSubmit={save}
                onCancel={onClose}
                status={status}
                onStatusChange={setStatus}
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
