import { useState } from "react";
import { toast } from "sonner";
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
import { useTaskMutations } from "@/features/tasks/hooks";
import type { Task } from "@/types";
export function DeleteTaskDialog({
  task,
  open,
  onOpenChange,
  onDeleted,
}: {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const { remove, purge } = useTaskMutations();
  const mutation = task.archivedAt ? purge : remove;
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!mutation.isPending) {
          setError(null);
          onOpenChange(value);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{task.title}” permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the task. This cannot be undone. Past chat messages and backups
            are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Keep task</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              setError(null);
              mutation.mutate(task.id, {
                onSuccess: () => {
                  toast.success("Task deleted");
                  onOpenChange(false);
                  onDeleted();
                },
                onError: (failure) => setError(failure.message),
              });
            }}
          >
            {mutation.isPending ? "Deleting…" : "Delete task"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
