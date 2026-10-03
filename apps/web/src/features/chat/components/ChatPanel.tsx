import { useEffect, useRef, useState } from "react";
import { Bot, Check, RefreshCw, Send, Square, X } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { StatePanel } from "@/components/layout/StatePanel";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { useChatMutations, useConversation } from "@/features/chat/hooks";
import { ApiError, type ChatAction } from "@/types";
import { CHAT_SUGGESTIONS } from "@/features/chat/suggestions";
import {
  AI_TEXT_LIMIT,
  countTrimmedCodePoints,
  isTextValidationError,
  trimApiText,
} from "@/shared/api/textLimits";
import { isAbortError } from "@/shared/cancellation";
import { cn } from "@/lib/utils";

const LIMIT_MESSAGE =
  "Messages to the assistant take up to 4,000 characters. Shorten your message.";
const LIMIT_MESSAGE_ID = "chat-limit-message";

function ActionCard({
  action,
  onConfirm,
  onReject,
  busy,
  stale,
}: {
  action: ChatAction;
  onConfirm: () => void;
  onReject: () => void;
  busy: boolean;
  /** The API said the target task changed, so Confirm would only fail again. */
  stale: boolean;
}) {
  return (
    <div className="mt-3 rounded-2xl border border-primary/30 bg-card p-3 text-card-foreground">
      <p className="section-label text-primary">{action.title}</p>
      <p className="mt-1.5 text-sm font-medium">{action.summary}</p>
      <dl className="mt-2 space-y-1 text-xs">
        {action.fields.map((f) => (
          <div key={f.label} className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">{f.label}</dt>
            <dd>
              {f.from ? <span className="text-muted-foreground line-through">{f.from}</span> : null}{" "}
              <span className="font-medium">{f.to}</span>
            </dd>
          </div>
        ))}
      </dl>
      {action.status === "pending" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {stale ? (
            <p className="w-full text-xs font-medium text-muted-foreground">
              This task changed after the proposal. Ask the assistant for an up-to-date preview.
            </p>
          ) : (
            <Button size="sm" onClick={onConfirm} disabled={busy}>
              <Check className="h-4 w-4" /> Confirm
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onReject} disabled={busy}>
            <X className="h-4 w-4" /> Cancel
          </Button>
        </div>
      ) : (
        <p
          className={cn(
            "mt-3 text-xs font-medium",
            action.status === "applied" ? "text-success-foreground" : "text-muted-foreground",
          )}
        >
          {action.status === "applied" ? "Applied to your board" : "Cancelled"}
        </p>
      )}
    </div>
  );
}

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const { data: conversation, isLoading } = useConversation();
  const { send, cancelSend, reset, confirm, reject } = useChatMutations();
  const [text, setText] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  // Actions whose Confirm failed with ACTION_STALE. Session state only; the API decides.
  const [staleIds, setStaleIds] = useState<ReadonlySet<string>>(new Set());
  const characterCount = countTrimmedCodePoints(text);
  const overLimit = characterCount > AI_TEXT_LIMIT;
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sentText = useRef("");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages.length, send.isPending]);

  // The one guard for every send path (Send, Enter, suggestions). A second mutate() on the
  // same mutation would drop the first call's onError, losing the text it would restore.
  // `fromInput` is true only when the text being sent is the input's own text.
  const submit = (value: string, fromInput: boolean) => {
    const trimmed = trimApiText(value);
    if (!trimmed || send.isPending || countTrimmedCodePoints(trimmed) > AI_TEXT_LIMIT) return;
    if (fromInput) setText("");
    sentText.current = trimmed;
    send.mutate(trimmed, {
      // A failed send persists nothing, so hand the text back rather than lose it —
      // unless the user has already started typing something else.
      onError: (e: Error) => {
        // A cancellation is not a failure (the panel may linger while the account changes).
        if (isAbortError(e)) return;
        setText((current) => (current === "" ? trimmed : current));
        toast.error(isTextValidationError(e) ? LIMIT_MESSAGE : e.message);
      },
    });
  };

  // Cancelling follows the failed-send rule: the text comes back unless the user typed more.
  const cancel = () => {
    cancelSend();
    setText((current) => (current === "" ? sentText.current : current));
    inputRef.current?.focus();
  };

  const messages = conversation?.messages ?? [];

  return (
    <div className="flex h-full flex-col bg-card">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <BrandMark className="size-9 rounded-full" />
          <div>
            <p className="text-sm font-semibold tracking-tight">AI Assistant</p>
            <p className="text-xs text-muted-foreground">
              {send.isPending ? "Thinking…" : "Ready"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 min-w-11"
            onClick={() => setConfirmNew(true)}
          >
            <RefreshCw className="h-4 w-4" /> New
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            aria-label="Close assistant"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto bg-background/60 px-4 py-5">
        {isLoading && <p className="text-sm text-muted-foreground">Loading conversation…</p>}
        {!isLoading && messages.length === 0 && (
          <div className="space-y-3">
            <StatePanel icon={Bot}>
              Ask about your tasks, or ask me to add, move or reschedule one. I never change
              anything without your confirmation.
            </StatePanel>
            <div className="flex flex-col gap-2">
              {CHAT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s, false)}
                  disabled={send.isPending}
                  className="min-h-11 cursor-pointer rounded-2xl border border-border bg-card px-4 py-2.5 text-left text-sm shadow-card transition-colors duration-150 hover:border-primary/50 hover:bg-secondary disabled:pointer-events-none disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
                m.role === "user"
                  ? "rounded-br-md bg-primary text-primary-foreground shadow-card"
                  : "rounded-bl-md border border-border bg-muted text-foreground",
              )}
            >
              {m.text}
              {m.action && (
                <ActionCard
                  action={m.action}
                  busy={confirm.isPending || reject.isPending}
                  stale={staleIds.has(m.action.id)}
                  onConfirm={() =>
                    confirm.mutate(m.action!.id, {
                      onSuccess: () => toast.success("Change applied"),
                      onError: (e: Error) => {
                        if (e instanceof ApiError && e.code === "ACTION_STALE")
                          setStaleIds((ids) => new Set(ids).add(m.action!.id));
                        toast.error(e.message);
                      },
                    })
                  }
                  onReject={() =>
                    reject.mutate(m.action!.id, {
                      onError: (e: Error) => toast.error(e.message),
                    })
                  }
                />
              )}
            </div>
          </div>
        ))}

        {send.isPending && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground" aria-live="polite">
            <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:120ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:240ms]" />
          </div>
        )}
        {send.isError && !isTextValidationError(send.error) && !isAbortError(send.error) && (
          <div className="rounded-2xl border border-destructive/30 bg-card p-3 text-sm text-destructive">
            The assistant didn't respond.{" "}
            <button className="min-h-11 min-w-11 underline" onClick={() => send.reset()}>
              Dismiss
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-border bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text, true);
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Message the assistant
        </label>
        <div className="flex items-end gap-2 rounded-2xl border border-input bg-background p-1.5 transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40">
          <Textarea
            id="chat-input"
            ref={inputRef}
            rows={2}
            value={text}
            aria-invalid={overLimit ? true : undefined}
            aria-describedby={overLimit ? LIMIT_MESSAGE_ID : undefined}
            className="min-h-0 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            placeholder="Ask about your tasks…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(text, true);
              }
            }}
          />
          <Button
            type="submit"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-xl bg-brand-gradient text-brand-foreground hover:brightness-110"
            disabled={send.isPending || overLimit}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {send.isPending && (
          <div className="mt-2 flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={cancel}>
              <Square className="h-4 w-4 fill-current" aria-hidden /> Cancel request
            </Button>
          </div>
        )}
        {overLimit && (
          <div className="mt-2 space-y-1 text-sm" aria-live="polite">
            <p id={LIMIT_MESSAGE_ID} className="text-destructive">
              {LIMIT_MESSAGE}
            </p>
            <p className="text-muted-foreground">
              {characterCount.toLocaleString("en-US")} / {AI_TEXT_LIMIT.toLocaleString("en-US")}{" "}
              characters
            </p>
          </div>
        )}
      </form>

      <AlertDialog open={confirmNew} onOpenChange={setConfirmNew}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start a new conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              The current chat history will be replaced. Your tasks are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep chat</AlertDialogCancel>
            <AlertDialogAction onClick={() => reset.mutate()}>New conversation</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
