import { useRef, useState, type RefObject } from "react";
import { Sparkles, Square, Wand2 } from "lucide-react";
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
import { TaskForm } from "@/features/tasks/components/TaskForm";
import { emptyDraft } from "@/features/tasks/formMapping";
import { useTaskMutations } from "@/features/tasks/hooks";
import { api } from "@/services/api";
import { isAbortError, useCancellableRequest } from "@/shared/cancellation";
import {
  AI_TEXT_LIMIT,
  countTrimmedCodePoints,
  isTextValidationError,
  trimApiText,
} from "@/shared/api/textLimits";
import { ApiError, type TaskDraft } from "@/types";

const EXAMPLE =
  "Prepare the search-quality review by Friday at 4 PM. This is high-priority work. Use https://example.com/dashboard.";
const LIMIT_MESSAGE =
  "Quick capture takes up to 4,000 characters. Shorten the text, or continue in the form.";
const LIMIT_MESSAGE_ID = "quick-capture-limit-message";

export function CreateTaskDialog({
  open,
  onOpenChange,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Element that takes focus when the dialog closes. */
  returnFocusTo?: RefObject<HTMLElement | null> | undefined;
}) {
  const { create } = useTaskMutations();
  const [tab, setTab] = useState("quick");
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<TaskDraft | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const request = useCancellableRequest();
  const closing = useRef(false);
  const characterCount = countTrimmedCodePoints(text);
  const overLimit = characterCount > AI_TEXT_LIMIT;
  const visibleError = overLimit ? LIMIT_MESSAGE : parseError;

  const close = () => {
    // Stop the parse now. The content stays as it is until the close animation is over.
    closing.current = true;
    request.abort();
    onOpenChange(false);
    setTimeout(() => {
      closing.current = false;
      setParsing(false);
      setTab("quick");
      setText("");
      setReviewDraft(null);
      setParseError(null);
    }, 200);
  };

  const parse = async () => {
    if (!trimApiText(text) || overLimit) return;
    const controller = request.begin();
    setParsing(true);
    setParseError(null);
    try {
      const draft = await api.parseTaskText(text, controller.signal);
      // A stopped or closed parse may still resolve; its result is never shown.
      if (controller.signal.aborted) return;
      setReviewDraft(draft);
    } catch (e) {
      if (controller.signal.aborted || isAbortError(e)) return;
      setParseError(isTextValidationError(e) ? LIMIT_MESSAGE : (e as Error).message);
    } finally {
      // A newer parse owns the progress state; a closing dialog resets it after its delay.
      if (request.isLatest(controller) && !closing.current) setParsing(false);
    }
  };

  // Unlike closing, this keeps the dialog and the note: the user can edit it and parse again.
  const stopParsing = () => {
    request.abort();
    setParsing(false);
    noteRef.current?.focus();
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
      <DialogContent
        className="max-h-[92vh] max-w-2xl overflow-y-auto"
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo?.current) return;
          event.preventDefault();
          returnFocusTo.current.focus();
        }}
      >
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
                  ref={noteRef}
                  rows={6}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setParseError(null);
                  }}
                  placeholder={EXAMPLE}
                  aria-label="Describe the task in your own words"
                  aria-invalid={overLimit || parseError === LIMIT_MESSAGE ? true : undefined}
                  aria-describedby={visibleError ? LIMIT_MESSAGE_ID : undefined}
                />
                <p className="text-xs text-muted-foreground">Example: “{EXAMPLE}”</p>
                {overLimit && (
                  <p className="text-xs text-muted-foreground">
                    {characterCount.toLocaleString("en-US")} /{" "}
                    {AI_TEXT_LIMIT.toLocaleString("en-US")} characters
                  </p>
                )}
                {visibleError && (
                  <div className="space-y-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                    <p id={LIMIT_MESSAGE_ID}>{visibleError}</p>
                    <Button variant="outline" size="sm" onClick={() => setTab("form")}>
                      Continue in the form instead
                    </Button>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  {parsing ? (
                    <Button variant="outline" onClick={stopParsing}>
                      <Square className="h-4 w-4 fill-current" aria-hidden /> Stop parsing
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={close}>
                      Cancel
                    </Button>
                  )}
                  <Button onClick={parse} disabled={parsing || !trimApiText(text) || overLimit}>
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
