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
import { captureApi } from "@/services/api";

/** Mock-mode only: the API has no counterpart for resetting demo data. */
export function DemoDataSection() {
  const api = captureApi();
  const qc = useQueryClient();
  const [resetOpen, setResetOpen] = useState(false);

  return (
    <>
      <section className="space-y-3 rounded-3xl border border-dashed border-border bg-card/60 p-6">
        <h2 className="text-base font-semibold tracking-tight">Demo data</h2>
        <p className="text-sm text-muted-foreground">
          Reset this account’s tasks, conversation and settings to their demo defaults.
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
              This account’s tasks, chat history and settings will be replaced with its demo
              defaults.
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
