import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { formatInZone } from "@/features/tasks/deadline";
import { SortableTaskCard, TaskCardContent } from "@/features/tasks/components/TaskCard";
import type { Task } from "@/types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Renew passport",
    content: "Bring photos",
    status: "todo",
    category: "personal",
    priority: "high",
    deadlineAt: new Date(Date.now() - HOUR).toISOString(),
    urls: [],
    markdownNote: "",
    position: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function renderCard(task: Task) {
  return render(<SortableTaskCard task={task} timezone="UTC" onOpen={vi.fn()} />);
}

describe("SortableTaskCard accessibility", () => {
  it("keeps the short name and describes the card with its badges", () => {
    const task = makeTask();
    renderCard(task);

    const button = screen.getByRole("button", { name: "Open task Renew passport" });
    expect(button).toHaveAccessibleName("Open task Renew passport");
    expect(button).toHaveAccessibleDescription(/Personal/);
    expect(button).toHaveAccessibleDescription(/High priority/);
    expect(button).toHaveAccessibleDescription(/Overdue/);
    expect(button).toHaveAccessibleDescription(
      new RegExp(formatInZone(task.deadlineAt, "UTC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    expect(screen.getByRole("button", { name: "Drag Renew passport" })).toBeInTheDocument();
  });

  it("describes a Done task with a past deadline as Completed, never Overdue", () => {
    renderCard(
      makeTask({
        status: "done",
        deadlineAt: new Date(Date.now() - DAY).toISOString(),
        completedAt: new Date().toISOString(),
      }),
    );
    const button = screen.getByRole("button", { name: "Open task Renew passport" });
    expect(button).toHaveAccessibleDescription(/Completed/);
    expect(button).not.toHaveAccessibleDescription(/Overdue/);
  });

  it("includes the link count and the note indicator", () => {
    renderCard(
      makeTask({
        urls: [
          { id: "u1", url: "https://a.example" },
          { id: "u2", url: "https://b.example" },
        ],
        markdownNote: "# hi",
      }),
    );
    const button = screen.getByRole("button", { name: "Open task Renew passport" });
    expect(button).toHaveAccessibleDescription(/2 links/);
    expect(button).toHaveAccessibleDescription(/Note/);
  });

  it("references an id that exists exactly once, even with an overlay copy rendered", () => {
    const task = makeTask();
    const { container } = render(
      <>
        <SortableTaskCard task={task} timezone="UTC" onOpen={vi.fn()} />
        <TaskCardContent task={task} timezone="UTC" dragging />
      </>,
    );
    const ids = Array.from(
      container.querySelectorAll('button[aria-label^="Open task"][aria-describedby]'),
    ).map((el) => el.getAttribute("aria-describedby"));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(container.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }
    expect(container.querySelectorAll("[id]").length).toBe(
      new Set(Array.from(container.querySelectorAll("[id]")).map((e) => e.id)).size,
    );
  });
});
