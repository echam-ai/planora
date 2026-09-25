import { describe, expect, it } from "vitest";
import {
  filterTasks,
  type BoardDeadlineFilter,
  type BoardFiltersState,
} from "@/features/tasks/boardFilters";
import type { Task } from "@/types";

const now = new Date("2026-01-15T12:00:00.000Z");

function task(overrides: Partial<Task>): Task {
  return {
    id: crypto.randomUUID(),
    title: "Task",
    content: "",
    status: "todo",
    category: "work",
    priority: "medium",
    deadlineAt: null,
    urls: [],
    markdownNote: "",
    position: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

const unrestricted: BoardFiltersState = { categories: [], priorities: [], deadlines: [] };

describe("filterTasks", () => {
  it("combines selections with OR within a dimension and AND across dimensions without reordering", () => {
    const tasks = [
      task({
        id: "first",
        category: "work",
        priority: "high",
        deadlineAt: "2026-01-17T12:00:00.001Z",
      }),
      task({
        id: "second",
        category: "personal",
        priority: "low",
        deadlineAt: "2026-01-15T11:59:59.999Z",
      }),
      task({
        id: "third",
        category: "study",
        priority: "low",
        deadlineAt: "2026-01-17T12:00:00.001Z",
      }),
      task({
        id: "fourth",
        category: "work",
        priority: "medium",
        deadlineAt: "2026-01-15T11:59:59.999Z",
      }),
    ];

    expect(
      filterTasks(
        tasks,
        "",
        {
          categories: ["work", "personal"],
          priorities: ["high", "low"],
          deadlines: ["scheduled", "overdue"],
        },
        now,
      ).map((item) => item.id),
    ).toEqual(["first", "second"]);
  });

  it("leaves an empty dimension unrestricted and combines search case-insensitively", () => {
    const tasks = [
      task({ id: "content", title: "Unrelated", content: "Ship RaFt notes", category: "personal" }),
      task({ id: "other", title: "Other", content: "", category: "work" }),
    ];

    expect(filterTasks(tasks, "raft", unrestricted, now).map((item) => item.id)).toEqual([
      "content",
    ]);
    expect(
      filterTasks(tasks, "", { ...unrestricted, categories: ["personal"] }, now).map(
        (item) => item.id,
      ),
    ).toEqual(["content"]);
  });

  it("matches deadline boundaries and excludes every Done deadline variant for every active deadline filter", () => {
    const tasks = [
      task({ id: "none", deadlineAt: null }),
      task({ id: "past", deadlineAt: "2026-01-15T11:59:59.999Z" }),
      task({ id: "future", deadlineAt: "2026-01-15T12:00:00.001Z" }),
      task({ id: "day", deadlineAt: "2026-01-16T12:00:00.000Z" }),
      task({ id: "scheduled", deadlineAt: "2026-01-16T12:00:00.001Z" }),
      task({ id: "done-none", status: "done", deadlineAt: null }),
      task({ id: "done-past", status: "done", deadlineAt: "2026-01-15T11:59:59.999Z" }),
      task({ id: "done-future", status: "done", deadlineAt: "2026-01-16T12:00:00.001Z" }),
    ];

    const matching = (deadlines: BoardFiltersState["deadlines"]) =>
      filterTasks(tasks, "", { ...unrestricted, deadlines }, now).map((item) => item.id);

    expect(matching(["none"])).toEqual(["none"]);
    expect(matching(["overdue"])).toEqual(["past"]);
    expect(matching(["due_soon"])).toEqual(["future", "day"]);
    expect(matching(["scheduled"])).toEqual(["scheduled"]);
    const deadlineOptions: BoardDeadlineFilter[] = ["none", "scheduled", "due_soon", "overdue"];
    const doneIds = ["done-none", "done-past", "done-future"];

    for (let mask = 1; mask < 1 << deadlineOptions.length; mask += 1) {
      const selected = deadlineOptions.filter((_, index) => mask & (1 << index));
      for (const doneId of doneIds) expect(matching(selected)).not.toContain(doneId);
    }

    // Clearing the dimension restores every Done card regardless of its stored deadline.
    expect(filterTasks(tasks, "", unrestricted, now).map((item) => item.id)).toEqual(
      expect.arrayContaining(doneIds),
    );
  });
});
