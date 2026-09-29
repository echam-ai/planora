import { useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { api } from "@/services/api";

/** Mock-mode only: the API has no counterpart for resetting demo data. */
export function DemoDataSection() {
  const qc = useQueryClient();
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <>
      <section className="space-y-3 rounded-2xl border border-dashed border-border p-6">
        <h2 className="text-sm font-semibold">Demo data</h2>
        <p className="text-sm text-muted-foreground">
          Reset everything back to the sample tasks and a fresh conversation.
        </p>
        <Button variant="outline" className="min-h-11" onClick={() => setResetOpen(true)}>
          <RotateCcw className="h-4 w-4" /> Reset demo data
        </Button>
      </section>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              All current tasks, chat history and settings will be replaced with the sample set.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await api.resetDemoData();
                await qc.invalidateQueries();
                toast.success("Demo data reset");
                setResetOpen(false);
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
