import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/services/api";
import { DEMO_UI_ENABLED } from "@/services/api/demoUi";
import { useSession } from "@/features/auth/hooks";
import { credentialsSchema, type Credentials } from "@/shared/domain/session";
import { APP_NAME } from "@/types";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — Planora" },
      { name: "description", content: "Sign in to your private Planora task workspace." },
      { property: "og:title", content: "Sign in — Planora" },
      { property: "og:description", content: "Sign in to your private Planora task workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) navigate({ to: "/tasks", replace: true });
  }, [session, navigate]);

  // The form is server-rendered, so the user (or a password manager) can fill
  // it before hydration. No `defaultValues`: with one, react-hook-form writes
  // it into each input as its ref attaches, erasing that text. Without one it
  // reads the DOM value instead, so an untouched field still validates as "".
  const form = useForm<Credentials>({ resolver: zodResolver(credentialsSchema) });

  // Before hydration nothing handles a submit, so the browser would do a
  // native GET and put the password in the URL. A disabled submit button
  // blocks click and implicit (Enter) submission until React takes over.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const onSubmit = async (values: Credentials) => {
    setError(null);
    try {
      const s = await api.login(values.username, values.password);
      qc.setQueryData(["session"], s);
      navigate({ to: "/tasks", replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gradient text-primary-foreground">
            <Sparkles className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="text-sm text-muted-foreground">
            Your private task board, woven together by an assistant.
          </p>
        </div>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-card"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input id="username" autoComplete="username" {...form.register("username")} />
            {form.formState.errors.username && (
              <p className="text-xs text-destructive">{form.formState.errors.username.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...form.register("password")}
            />
            {form.formState.errors.password && (
              <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="min-h-11 w-full"
            disabled={!hydrated || form.formState.isSubmitting}
          >
            {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </Button>

          {DEMO_UI_ENABLED && (
            <p className="text-center text-xs text-muted-foreground">
              Demo login: <span className="font-medium">demo</span> /{" "}
              <span className="font-medium">focusboard</span>
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
