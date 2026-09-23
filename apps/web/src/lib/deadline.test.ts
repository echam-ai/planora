import { describe, expect, it } from "vitest";

import { deadlineLabels, formatInZone, getDeadlineState } from "./deadline";
import type { Task } from "@/types";

const now = new Date("2026-01-15T12:00:00.000Z");

function taskWithDeadline(deadlineAt: string | null): Task {
  return {
    id: "task-1",
    title: "Test task",
    content: "",
    status: "todo",
    category: "work",
    priority: "medium",
    deadlineAt,
    urls: [],
    markdownNote: "",
    position: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    completedAt: null,
    archivedAt: null,
  };
}

describe("getDeadlineState", () => {
  it("returns none when a task has no deadline", () => {
    expect(getDeadlineState(taskWithDeadline(null), now)).toBe("none");
  });

  it("returns scheduled when more than 24 hours remain", () => {
    expect(getDeadlineState(taskWithDeadline("2026-01-16T12:00:00.001Z"), now)).toBe("scheduled");
  });

  it("returns due soon when exactly 24 hours remain", () => {
    expect(getDeadlineState(taskWithDeadline("2026-01-16T12:00:00.000Z"), now)).toBe("due_soon");
  });

  it("returns overdue when the deadline has passed", () => {
    expect(getDeadlineState(taskWithDeadline("2026-01-15T11:59:59.999Z"), now)).toBe("overdue");
  });

  it("returns completed for Done tasks regardless of their deadline", () => {
    const task = taskWithDeadline("2026-01-15T11:59:59.999Z");
    task.status = "done";

    expect(getDeadlineState(task, now)).toBe("completed");
  });
});

describe("deadline display helpers", () => {
  it("includes labels for every deadline state", () => {
    expect(deadlineLabels).toEqual({
      none: "No deadline",
      scheduled: "Scheduled",
      due_soon: "Due soon",
      overdue: "Overdue",
      completed: "Completed",
    });
  });

  it("formats null and valid deadline values", () => {
    expect(formatInZone(null, "UTC")).toBe("—");
    expect(formatInZone("2026-01-15T12:00:00.000Z", "UTC", false)).toBe("15 Jan 2026");
  });
});
