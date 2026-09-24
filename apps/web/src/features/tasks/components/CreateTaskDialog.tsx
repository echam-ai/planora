import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskForm, emptyDraft } from "@/features/tasks/components/TaskForm";
import { useTaskMutations } from "@/features/tasks/hooks";
import { api } from "@/services/api";
import type { TaskDraft } from "@/types";

const EXAMPLE =
  "Prepare the search-quality review by Friday at 4 PM. This is high-priority work. Use https://example.com/dashboard.";

export function CreateTaskDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { create } = useTaskMutations();
  const [tab, setTab] = useState("quick");
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<TaskDraft | null>(null);

  const close = () => {
    onOpenChange(false);
    setTimeout(() => {
      setTab("quick");
      setText("");
      setReviewDraft(null);
      setParseError(null);
    }, 200);
  };

  const parse = async () => {
    if (!text.trim()) return;
    setParsing(true);
    setParseError(null);
    try {
      const draft = await api.parseTaskText(text);
      setReviewDraft(draft);
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const submit = (draft: TaskDraft) => {
    create.mutate(draft, {
      onSuccess: () => {
        toast.success("Task added to Todo");
        close();
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a task</DialogTitle>
          <DialogDescription>Capture it quickly, or fill in the full form.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="quick" className="flex-1">
              Quick capture
            </TabsTrigger>
            <TabsTrigger value="form" className="flex-1">
              Task form
            </TabsTrigger>
          </TabsList>

          <TabsContent value="quick" className="space-y-4 pt-4">
            {!reviewDraft && (
              <>
                <Textarea
                  rows={6}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={EXAMPLE}
                  aria-label="Describe the task in your own words"
                />
                <p className="text-xs text-muted-foreground">Example: “{EXAMPLE}”</p>
                {parseError && (
                  <div className="space-y-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                    <p>{parseError}</p>
                    <Button variant="outline" size="sm" onClick={() => setTab("form")}>
                      Continue in the form instead
                    </Button>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={close}>
                    Cancel
                  </Button>
                  <Button onClick={parse} disabled={parsing || !text.trim()}>
                    {parsing ? (
                      <>
                        <Sparkles className="h-4 w-4 animate-pulse" /> Reading your note…
                      </>
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4" /> Parse task
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}

            {reviewDraft && (
              <div className="space-y-4">
                <div className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
                  Review the details before saving — nothing is created until you choose
                  <strong> Create task</strong>.
                </div>
                <TaskForm
                  defaultDraft={reviewDraft}
                  submitLabel="Create task"
                  submitting={create.isPending}
                  onSubmit={submit}
                  onCancel={close}
                  extraActions={
                    <Button variant="ghost" onClick={() => setReviewDraft(null)} type="button">
                      Back to text
                    </Button>
                  }
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="form" className="pt-4">
            <TaskForm
              defaultDraft={{ ...emptyDraft, content: text }}
              submitLabel="Create task"
              submitting={create.isPending}
              onSubmit={submit}
              onCancel={close}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
