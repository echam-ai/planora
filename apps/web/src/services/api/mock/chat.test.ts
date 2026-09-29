import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/types";
import { mockApiClient, mockDevTools } from "../mockApiClient";

async function resolve<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

async function ask(text: string) {
  const conversation = await resolve(mockApiClient.sendChatMessage(text));
  return conversation.messages.at(-1)!;
}

async function tasks(): Promise<Task[]> {
  return resolve(mockApiClient.listTasks());
}

/** Edits the stored tasks directly, as if they had been changed elsewhere. */
async function patchTasks(patch: (task: Task) => Partial<Task>) {
  const all = await tasks();
  window.localStorage.setItem(
    "planora.tasks",
    JSON.stringify(all.map((task) => ({ ...task, ...patch(task) }))),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T08:00:00.000Z"));
  let random = 0;
  vi.spyOn(Math, "random").mockImplementation(() => (random += 0.0001));
  window.localStorage.clear();
  mockDevTools.setErrorMode(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("mock chat: overdue", () => {
  it("lists only active overdue tasks, never Done ones", async () => {
    const reply = await ask("What is overdue?");

    expect(reply.text).toMatch(/^You have 1 overdue task:\n/);
    expect(reply.text).toContain("Ship the search-quality review deck");
    for (const done of [
      "Write the weekly status update",
      "Submit the reimbursement claim",
      "Finish the linear algebra problem set",
    ])
      expect(reply.text).not.toContain(done);
  });

  it("pluralises for two overdue tasks and says so when none are left", async () => {
    await patchTasks((task) =>
      task.title === "Renew passport" ? { deadlineAt: "2026-09-23T08:00:00.000Z" } : {},
    );
    expect((await ask("What is overdue?")).text).toMatch(/^You have 2 overdue tasks:\n/);

    await patchTasks((task) =>
      ["Renew passport", "Ship the search-quality review deck"].includes(task.title)
        ? { status: "done" }
        : {},
    );
    expect((await ask("What is overdue?")).text).toBe("Nothing is overdue right now. Nice.");
  });
});

describe("mock chat: due today", () => {
  it("says nothing is due when no active task is within 24 hours", async () => {
    await patchTasks(() => ({ deadlineAt: null }));

    expect((await ask("What is due today?")).text).toBe("Nothing is due within the next 24 hours.");
  });
});

describe("mock chat: category and priority questions", () => {
  it("filters active tasks by category and priority", async () => {
    const reply = await ask("Show high-priority study tasks");

    expect(reply.text).toMatch(/^Found 1 matching task:\n/);
    expect(reply.text).toContain("Finish the linear algebra problem set");
    expect(reply.text).not.toContain("Renew passport");
  });

  it("uses the plural when several tasks match", async () => {
    const work = (await tasks()).filter((task) => !task.archivedAt && task.category === "work");
    expect(work.length).toBeGreaterThan(1);

    const reply = await ask("Show work tasks");

    expect(reply.text).toMatch(new RegExp(`^Found ${work.length} matching tasks:\\n`));
  });

  it("says so when nothing matches", async () => {
    await patchTasks((task) => (task.category === "study" ? { priority: "low" } : {}));

    expect((await ask("Show high-priority study tasks")).text).toBe(
      "No tasks match that description.",
    );
  });

  it("leaves archived tasks out of the results", async () => {
    expect((await ask("Show work tasks")).text).toContain("Ship the search-quality review deck");
    await patchTasks((task) =>
      task.title === "Ship the search-quality review deck"
        ? { archivedAt: "2026-09-23T08:00:00.000Z" }
        : {},
    );

    expect((await ask("Show work tasks")).text).not.toContain(
      "Ship the search-quality review deck",
    );
  });
});

describe("mock chat: fallback", () => {
  it("summarises the board, counting active tasks only", async () => {
    const reply = await ask("hello");

    expect(reply.text).toMatch(/^Right now you have 5 in Todo, 4 in Progress and 3 Done\. /);
    expect(reply.action).toBeUndefined();
  });
});

describe("mock chat: move proposals", () => {
  const statusOf = async (title: string) =>
    (await tasks()).find((task) => task.title === title)?.status;

  it.each([
    ["move 'Tidy the garage shelves' to done", "Tidy the garage shelves", "Todo", "Done"],
    [
      "move 'Finish the linear algebra problem set' to todo",
      "Finish the linear algebra problem set",
      "Done",
      "Todo",
    ],
    ["start 'Tidy the garage shelves'", "Tidy the garage shelves", "Todo", "In Progress"],
  ])("%s", async (message, title, from, to) => {
    const before = await statusOf(title);

    const reply = await ask(message);

    expect(reply.action).toMatchObject({
      kind: "move",
      status: "pending",
      summary: title,
      fields: [{ label: "Status", from, to }],
    });
    expect(await statusOf(title)).toBe(before);
  });

  it("matches an unquoted title by its first 12 characters", async () => {
    const reply = await ask("start draft q4 hiring plan");

    expect(reply.action).toMatchObject({
      kind: "move",
      summary: "Draft Q4 hiring plan",
      fields: [{ label: "Status", from: "Todo", to: "In Progress" }],
    });
  });

  it("makes no proposal and changes nothing for a task that does not exist", async () => {
    const before = await tasks();

    const reply = await ask("move 'No such task' to done");

    expect(reply.action).toBeUndefined();
    expect(await tasks()).toEqual(before);
  });
});

describe("mock chat: schedule and priority proposals", () => {
  it("makes no schedule proposal for an unknown task", async () => {
    const before = await tasks();

    const reply = await ask("schedule 'No such task' tomorrow at 3pm");

    expect(reply.action).toBeUndefined();
    expect(await tasks()).toEqual(before);
  });

  it("makes no schedule proposal when the message has no day or time", async () => {
    const before = await tasks();

    const reply = await ask("schedule 'Tidy the garage shelves'");

    expect(reply.action).toBeUndefined();
    expect(await tasks()).toEqual(before);
  });

  it("proposes lowering the priority from its current value", async () => {
    const reply = await ask("make it low 'Renew passport'");

    expect(reply.action).toMatchObject({
      kind: "update",
      summary: "Renew passport",
      fields: [{ label: "Priority", from: "high", to: "low" }],
    });
  });

  it("makes no priority proposal for an unknown task", async () => {
    const before = await tasks();

    const reply = await ask("make it low 'No such task'");

    expect(reply.action).toBeUndefined();
    expect(await tasks()).toEqual(before);
  });
});

describe("mock chat: create proposals", () => {
  const field = (message: Awaited<ReturnType<typeof ask>>, label: string) =>
    message.action?.fields.find((candidate) => candidate.label === label);

  it("shows no deadline as None and reads low-priority words", async () => {
    const reply = await ask("add a task to call the bank someday");

    expect(reply.action?.kind).toBe("create");
    expect(field(reply, "Deadline")).toEqual({ label: "Deadline", to: "None" });
    expect(field(reply, "Priority")).toEqual({ label: "Priority", to: "low" });
  });

  it("cuts a first sentence over 72 characters to 69 plus an ellipsis", async () => {
    const sentence =
      "Prepare the quarterly planning document for every team lead across all regions";
    expect(sentence.length).toBeGreaterThan(72);

    const reply = await ask(`create task ${sentence}`);

    expect(reply.action?.summary).toBe(`${sentence.slice(0, 69)}…`);
    expect(field(reply, "Title")?.to).toBe(`${sentence.slice(0, 69)}…`);
  });

  it("keeps a first sentence of exactly 72 characters whole", async () => {
    const sentence = "Prepare the quarterly planning document for every team lead across all r";
    expect(sentence).toHaveLength(72);

    const reply = await ask(`create task ${sentence}`);

    expect(reply.action?.summary).toBe(sentence);
  });

  it("titles a message that is only a URL 'New task'", async () => {
    const reply = await ask("create task https://example.com");

    expect(reply.action?.summary).toBe("New task");
  });
});
