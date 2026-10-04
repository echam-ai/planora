import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/services/api";
import { DEMO_UI_ENABLED } from "@/services/api/demoUi";
import { setAccessState } from "../access";
import { UNLOCK_MESSAGES, unlockErrorMessage } from "../unlockError";

/**
 * The shared site password form (#124).
 *
 * It is server-rendered, so it can be filled before React hydrates. The field is therefore
 * uncontrolled and read from the DOM on submit: a controlled field would have its early text
 * overwritten by the first re-render. The Unlock button stays disabled until hydration, which
 * also blocks Enter's implicit submission, so a password is never sent natively by accident. A
 * native `POST /login` that still happens (a script that failed to load, `form.submit()`) is
 * answered by the server with a plain 303 back to this page and carries nothing.
 */
export function UnlockForm() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const alertId = useId();
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setHydrated(true), []);

  const refocus = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const password = inputRef.current?.value ?? "";
    if (password === "") {
      setError(UNLOCK_MESSAGES.empty);
      refocus();
      return;
    }
    setError(null);
    setPending(true);
    try {
      await api.unlock(password);
    } catch (failure) {
      setError(unlockErrorMessage(failure));
      setPending(false);
      refocus();
      return;
    }
    // The page stays busy: it is replaced by the chooser, not re-enabled.
    setAccessState("unlocked");
    navigate({ to: "/", replace: true });
  }

  return (
    <form
      method="post"
      action="/login"
      noValidate
      onSubmit={onSubmit}
      className="space-y-4 rounded-3xl border border-border bg-card p-6 text-left shadow-card"
    >
      <div className="space-y-2">
        <Label htmlFor="site-password">Password</Label>
        <Input
          ref={inputRef}
          id="site-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? alertId : undefined}
        />
      </div>

      {error && (
        <p
          id={alertId}
          role="alert"
          className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
        >
          {error}
        </p>
      )}

      <Button
        type="submit"
        className="min-h-11 w-full rounded-full"
        disabled={!hydrated || pending}
        aria-busy={pending}
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Unlock
      </Button>

      {DEMO_UI_ENABLED && (
        <p className="text-center text-xs text-muted-foreground">
          Demo password: <span className="font-medium text-foreground">focusboard</span>
        </p>
      )}
    </form>
  );
}
