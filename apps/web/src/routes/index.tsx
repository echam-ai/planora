import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useSession } from "@/features/auth/hooks";
import { APP_NAME } from "@/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Planora — Your calm AI task board" },
      {
        name: "description",
        content:
          "Planora is a private AI task manager with a drag-and-drop board, smart quick capture, and an assistant that confirms every change.",
      },
      { property: "og:title", content: "Planora — Your calm AI task board" },
      {
        property: "og:description",
        content:
          "Plan, prioritise and finish your day with a colourful board and an AI assistant that asks before it acts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const { data: session, isLoading } = useSession();

  useEffect(() => {
    if (isLoading) return;
    navigate({ to: session ? "/tasks" : "/login", replace: true });
  }, [session, isLoading, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-2xl bg-brand-gradient text-primary-foreground">
        <Sparkles className="h-6 w-6" aria-hidden />
      </span>
      <h1 className="text-lg font-semibold tracking-tight">{APP_NAME}</h1>
      <p className="text-sm text-muted-foreground">Loading your workspace…</p>
    </div>
  );
}
