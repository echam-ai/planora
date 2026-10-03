import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { Board } from "@/features/tasks/components/Board";
import { useProfileGuard } from "@/hooks/useProfileGuard";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Active tasks — Planora" },
      {
        name: "description",
        content:
          "Drag tasks across To do, In progress and Done, filter by category, priority or deadline, and keep today's plan in view.",
      },
      { property: "og:title", content: "Active tasks — Planora" },
      {
        property: "og:description",
        content: "A colourful drag-and-drop board for everything you're working on.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TasksPage,
});

function TasksPage() {
  useProfileGuard();

  return (
    <AppShell>
      <Board />
    </AppShell>
  );
}
