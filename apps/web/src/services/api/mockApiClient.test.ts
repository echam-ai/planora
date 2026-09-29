import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatInZone } from "@/features/tasks/deadline";
import { ApiError, type Task, type TaskDraft } from "@/types";
import { mockApiClient, mockDevTools } from "./mockApiClient";

const draft: TaskDraft = {
  title: "Write characterization tests",
  content: "Keep mock behavior stable during the extraction.",
  category: "work",
  priority: "high",
  deadlineAt: null,
  urls: [],
  markdownNote: "",
};

async function resolve<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

async function expectApiError(promise: Promise<unknown>, code: string, message: string) {
  const expectation = expect(promise).rejects.toMatchObject({ code, message });
  await vi.runAllTimersAsync();
  await expectation;
}

function storedTasks(): Task[] {
  return JSON.parse(window.localStorage.getItem("planora.tasks") ?? "[]") as Task[];
}

describe("mock API client characterization", () => {
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

  it("preserves authentication, settings, password, and session storage behavior", async () => {
    await expectApiError(
      mockApiClient.login("demo", "wrong"),
      "INVALID_CREDENTIALS",
      "That username or password isn't right.",
    );
    const session = await resolve(mockApiClient.login(" DEMO ", "focusboard"));
    expect(session).toEqual({ username: "demo", signedInAt: "2026-09-24T08:00:00.500Z" });
    expect(await resolve(mockApiClient.getSession())).toEqual(session);
    expect(await resolve(mockApiClient.getSettings())).toEqual({
      timezone: "Asia/Singapore",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    expect(await resolve(mockApiClient.updateSettings({ timezone: "UTC" }))).toEqual({
      timezone: "UTC",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    await expectApiError(
      mockApiClient.changePassword("wrong", "new-password"),
      "WRONG_PASSWORD",
      "Your current password is incorrect.",
    );
    await resolve(mockApiClient.changePassword("focusboard", "new-password"));
    await resolve(mockApiClient.logout());
    expect(await resolve(mockApiClient.getSession())).toBeNull();
    await resolve(mockApiClient.login("demo", "new-password"));
  });

  it("preserves task CRUD, ordering, timestamps, persistence, and mutation errors", async () => {
    const seeded = await resolve(mockApiClient.listTasks());
    expect(seeded.length).toBeGreaterThan(0);
    const created = await resolve(mockApiClient.createTask(draft));
    expect(created).toMatchObject({ ...draft, status: "todo", position: 5, completedAt: null });
    expect(created.createdAt).toBe("2026-09-24T08:00:00.500Z");
    expect(await resolve(mockApiClient.getTask(created.id))).toEqual(created);
    const done = await resolve(mockApiClient.updateTask(created.id, { status: "done" }));
    expect(done.completedAt).toBe("2026-09-24T08:00:00.901Z");
    const todo = await resolve(mockApiClient.moveTask(created.id, "todo", 0));
    expect(todo.find((task) => task.id === created.id)).toMatchObject({
      position: 0,
      completedAt: null,
    });
    const reordered = await resolve(mockApiClient.reorderTasks("todo", [created.id]));
    expect(reordered.find((task) => task.id === created.id)?.position).toBe(0);
    await expectApiError(
      mockApiClient.getTask("missing"),
      "NOT_FOUND",
      "That task no longer exists.",
    );
    mockDevTools.setErrorMode(true);
    await expectApiError(
      mockApiClient.createTask(draft),
      "SIMULATED_FAILURE",
      "Simulated failure while trying to create the task.",
    );
    await expectApiError(
      mockApiClient.updateTask(created.id, { title: "Blocked update" }),
      "SIMULATED_FAILURE",
      "Simulated failure while trying to save the task.",
    );
    await expectApiError(
      mockApiClient.moveTask(created.id, "done", 0),
      "SIMULATED_FAILURE",
      "Simulated failure while trying to move the task.",
    );
    expect(storedTasks().some((task) => task.id === created.id)).toBe(true);
    mockDevTools.setErrorMode(false);
    await resolve(mockApiClient.deleteTask(created.id));
    expect(storedTasks().some((task) => task.id === created.id)).toBe(false);
  });

  it("preserves archived task search, pagination, restore, deletion, and errors", async () => {
    const archived = Array.from({ length: 12 }, (_, index) => ({
      ...draft,
      id: `archive-${index}`,
      title: `  Archive ${index}  `,
      status: "done" as const,
      position: index,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      completedAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      archivedAt: `2026-09-${String(index + 1).padStart(2, "0")}T01:00:00.000Z`,
    }));
    window.localStorage.setItem("planora.tasks", JSON.stringify(archived));
    const pageOne = await resolve(mockApiClient.listArchive(" archive "));
    expect(pageOne).toMatchObject({ total: 12, page: 1, pageSize: 10 });
    expect(pageOne.items.map((task) => task.id)).toEqual([
      "archive-11",
      "archive-10",
      "archive-9",
      "archive-8",
      "archive-7",
      "archive-6",
      "archive-5",
      "archive-4",
      "archive-3",
      "archive-2",
    ]);
    expect(
      (await resolve(mockApiClient.listArchive("ARCHIVE", 2))).items.map((task) => task.id),
    ).toEqual(["archive-1", "archive-0"]);
    expect(await resolve(mockApiClient.getArchivedTask("archive-11"))).toMatchObject({
      id: "archive-11",
      archivedAt: "2026-09-12T01:00:00.000Z",
    });
    await expectApiError(
      mockApiClient.getArchivedTask("missing"),
      "NOT_FOUND",
      "That archived task no longer exists.",
    );
    const restored = await resolve(mockApiClient.restoreTask("archive-11"));
    expect(restored).toMatchObject({
      status: "todo",
      archivedAt: null,
      completedAt: null,
      position: 0,
    });
    await resolve(mockApiClient.permanentlyDeleteTask("archive-10"));
    expect(storedTasks().some((task) => task.id === "archive-10")).toBe(false);
    mockDevTools.setErrorMode(true);
    await expectApiError(
      mockApiClient.permanentlyDeleteTask("archive-9"),
      "SIMULATED_FAILURE",
      "Simulated failure while trying to delete the task.",
    );
    mockDevTools.setErrorMode(false);
  });

  it("preserves parsing, chat proposal, confirmation, rejection, and failure behavior", async () => {
    const before = await resolve(mockApiClient.listTasks());
    const preview = await resolve(
      mockApiClient.parseTaskText("urgent work review tomorrow at 3pm https://example.com"),
    );
    expect(preview).toMatchObject({
      title: "Urgent work review tomorrow at 3pm",
      category: "work",
      priority: "high",
    });
    expect(await resolve(mockApiClient.listTasks())).toEqual(before);
    await expectApiError(
      mockApiClient.parseTaskText("fail to parse"),
      "AI_UNAVAILABLE",
      "The assistant couldn't parse that right now.",
    );

    const conversation = await resolve(mockApiClient.sendChatMessage("create task to buy milk"));
    const action = conversation.messages.at(-1)?.action;
    expect(action).toMatchObject({ kind: "create", status: "pending", summary: "Buy milk" });
    expect(
      (await resolve(mockApiClient.listTasks())).some((task) => task.title === "Buy milk"),
    ).toBe(false);
    const confirmed = await resolve(mockApiClient.confirmChatAction(action!.id));
    expect(confirmed.messages.at(-2)?.action?.status).toBe("applied");
    expect(
      (await resolve(mockApiClient.listTasks())).some((task) => task.title === "Buy milk"),
    ).toBe(true);
    expect(
      (await resolve(mockApiClient.confirmChatAction(action!.id)).then((value) => value.messages))
        .length,
    ).toBe(confirmed.messages.length);
    await expectApiError(
      mockApiClient.confirmChatAction("missing"),
      "NOT_FOUND",
      "That proposed change is no longer available.",
    );
    const rejected = await resolve(mockApiClient.sendChatMessage("create task to buy bread"));
    const rejectedAction = rejected.messages.at(-1)?.action;
    const rejectedConversation = await resolve(mockApiClient.rejectChatAction(rejectedAction!.id));
    expect(rejectedConversation.messages.at(-1)?.action?.status).toBe("rejected");
    mockDevTools.setErrorMode(true);
    await expectApiError(
      mockApiClient.sendChatMessage("hello"),
      "AI_UNAVAILABLE",
      "The assistant is unavailable. Try again.",
    );
  });

  it("confirms move, schedule, and update proposals only after confirmation", async () => {
    const task = (await resolve(mockApiClient.listTasks())).find(
      (candidate) => candidate.title === "Tidy the garage shelves",
    )!;
    const move = await resolve(
      mockApiClient.sendChatMessage("move 'Tidy the garage shelves' to done"),
    );
    const moveAction = move.messages.at(-1)?.action;
    expect(moveAction).toMatchObject({ kind: "move", status: "pending" });
    if (!moveAction) throw new Error("Expected a move proposal");
    expect((await resolve(mockApiClient.getTask(task.id))).status).toBe("todo");
    await resolve(mockApiClient.confirmChatAction(moveAction.id));
    expect((await resolve(mockApiClient.getTask(task.id))).status).toBe("done");

    const schedule = await resolve(
      mockApiClient.sendChatMessage("schedule 'Tidy the garage shelves' tomorrow at 3pm"),
    );
    const scheduleAction = schedule.messages.at(-1)?.action;
    expect(scheduleAction).toMatchObject({ kind: "schedule", status: "pending" });
    if (!scheduleAction) throw new Error("Expected a schedule proposal");
    expect((await resolve(mockApiClient.getTask(task.id))).deadlineAt).toBeNull();
    await resolve(mockApiClient.confirmChatAction(scheduleAction.id));
    expect(scheduleAction.fields[0]).toEqual({
      label: "Deadline",
      from: "No deadline",
      to: "25 Sep 2026, 15:00",
    });
    expect((await resolve(mockApiClient.getTask(task.id))).deadlineAt).toBe(
      "2026-09-25T07:00:00.000Z",
    );

    const update = await resolve(
      mockApiClient.sendChatMessage("make it high 'Tidy the garage shelves'"),
    );
    const updateAction = update.messages.at(-1)?.action;
    expect(updateAction).toMatchObject({ kind: "update", status: "pending" });
    if (!updateAction) throw new Error("Expected an update proposal");
    expect((await resolve(mockApiClient.getTask(task.id))).priority).toBe("low");
    await resolve(mockApiClient.confirmChatAction(updateAction.id));
    expect((await resolve(mockApiClient.getTask(task.id))).priority).toBe("high");
  });

  describe("chat deadlines use the Settings timezone", () => {
    async function proposedDeadline(text: string) {
      const conversation = await resolve(mockApiClient.sendChatMessage(text));
      return conversation.messages.at(-1)?.action?.payload.deadlineAt;
    }
    const message = "schedule 'Tidy the garage shelves' tomorrow at 3pm";

    it("counts tomorrow from the calendar date in the Settings zone", async () => {
      vi.setSystemTime(new Date("2026-09-24T18:00:00.000Z"));
      expect(await proposedDeadline(message)).toBe("2026-09-26T07:00:00.000Z");
    });

    it("follows a Settings timezone change", async () => {
      await resolve(mockApiClient.updateSettings({ timezone: "America/New_York" }));
      expect(await proposedDeadline(message)).toBe("2026-09-25T19:00:00.000Z");
    });

    it("defaults a bare day to 17:00 and reads am/pm times in the Settings zone", async () => {
      expect(await proposedDeadline("schedule 'Tidy the garage shelves' tomorrow")).toBe(
        "2026-09-25T09:00:00.000Z",
      );
      expect(await proposedDeadline("schedule 'Tidy the garage shelves' today at 9:30am")).toBe(
        "2026-09-24T01:30:00.000Z",
      );
    });

    it("resolves weekdays and next week from the Settings zone date", async () => {
      // 2026-09-24 is a Thursday in Singapore.
      expect(await proposedDeadline("schedule 'Tidy the garage shelves' friday at 3pm")).toBe(
        "2026-09-25T07:00:00.000Z",
      );
      expect(await proposedDeadline("schedule 'Tidy the garage shelves' next week at 3pm")).toBe(
        "2026-10-01T07:00:00.000Z",
      );
    });

    it("gives quick capture the same instant as chat", async () => {
      const parsed = await resolve(mockApiClient.parseTaskText("Call the plumber tomorrow at 3pm"));
      expect(parsed.deadlineAt).toBe("2026-09-25T07:00:00.000Z");
    });

    it("shows listed deadlines in the Settings zone in the board format", async () => {
      await resolve(mockApiClient.updateSettings({ timezone: "America/New_York" }));
      const reply = await resolve(mockApiClient.sendChatMessage("What is near deadline?"));
      const task = (await resolve(mockApiClient.listTasks())).find(
        (candidate) => candidate.title === "Renew passport",
      )!;
      const expected = formatInZone(task.deadlineAt, "America/New_York");
      expect(expected).toMatch(/^\d{2} \w{3} 2026, \d{2}:\d{2}$/);
      expect(reply.messages.at(-1)?.text).toContain(`Renew passport — `);
      expect(reply.messages.at(-1)?.text).toContain(expected);
    });
  });

  it("answers 'near deadline' and 'due soon' questions with the same due-within-24-hours reply", async () => {
    const nearDeadline = await resolve(mockApiClient.sendChatMessage("What is near deadline?"));
    const nearDeadlineReply = nearDeadline.messages.at(-1)?.text;
    expect(nearDeadlineReply).toMatch(/^Due within 24 hours:/);
    expect(nearDeadlineReply).toContain("Renew passport");
    expect(nearDeadlineReply).toContain("Fix flaky checkout integration test");
    expect(nearDeadlineReply).toContain("Replace the kitchen tap washer");

    const dueSoon = await resolve(mockApiClient.sendChatMessage("What is due soon?"));
    expect(dueSoon.messages.at(-1)?.text).toBe(nearDeadlineReply);
  });

  describe("chat outcomes match the API", () => {
    const NOT_FOUND = "That proposed change is no longer available.";
    const REJECTED = "This change was cancelled, so it wasn't applied.";
    const APPLIED = "This change has already been applied.";

    async function propose(text: string) {
      const conversation = await resolve(mockApiClient.sendChatMessage(text));
      const action = conversation.messages.at(-1)?.action;
      if (!action) throw new Error("Expected a proposal");
      return action;
    }
    async function expectStatus(
      promise: Promise<unknown>,
      code: string,
      status: number,
      message: string,
    ) {
      const expectation = expect(promise).rejects.toMatchObject({ code, status, message });
      await vi.runAllTimersAsync();
      await expectation;
    }

    it("confirming a rejected action fails 409 ACTION_ALREADY_REJECTED and writes nothing", async () => {
      const action = await propose("create task to buy tea");
      await resolve(mockApiClient.rejectChatAction(action.id));
      const before = await resolve(mockApiClient.getCurrentConversation());
      const tasksBefore = await resolve(mockApiClient.listTasks());
      await expectStatus(
        mockApiClient.confirmChatAction(action.id),
        "ACTION_ALREADY_REJECTED",
        409,
        REJECTED,
      );
      expect(await resolve(mockApiClient.getCurrentConversation())).toEqual(before);
      expect(await resolve(mockApiClient.listTasks())).toEqual(tasksBefore);
    });

    it("rejecting an applied action fails 409 ACTION_ALREADY_APPLIED", async () => {
      const action = await propose("create task to buy jam");
      await resolve(mockApiClient.confirmChatAction(action.id));
      await expectStatus(
        mockApiClient.rejectChatAction(action.id),
        "ACTION_ALREADY_APPLIED",
        409,
        APPLIED,
      );
    });

    it("rejecting or confirming an unknown id fails 404 NOT_FOUND", async () => {
      await expectStatus(mockApiClient.rejectChatAction("missing"), "NOT_FOUND", 404, NOT_FOUND);
      await expectStatus(mockApiClient.confirmChatAction("missing"), "NOT_FOUND", 404, NOT_FOUND);
    });

    it("rejecting a rejected action is an idempotent no-op", async () => {
      const action = await propose("create task to buy figs");
      const first = await resolve(mockApiClient.rejectChatAction(action.id));
      expect(await resolve(mockApiClient.rejectChatAction(action.id))).toEqual(first);
    });

    it("confirming an applied create twice adds one task and one confirmation message", async () => {
      const action = await propose("create task to buy rice");
      const first = await resolve(mockApiClient.confirmChatAction(action.id));
      const tasks = await resolve(mockApiClient.listTasks());
      const second = await resolve(mockApiClient.confirmChatAction(action.id));
      expect(second).toEqual(first);
      expect(second.messages.filter((m) => m.text.startsWith("Done"))).toHaveLength(1);
      expect(await resolve(mockApiClient.listTasks())).toEqual(tasks);
    });

    it("a failed send persists nothing", async () => {
      await resolve(mockApiClient.getCurrentConversation());
      const before = window.localStorage.getItem("planora.conversation");
      mockDevTools.setErrorMode(true);
      await expectApiError(
        mockApiClient.sendChatMessage("hello"),
        "AI_UNAVAILABLE",
        "The assistant is unavailable. Try again.",
      );
      mockDevTools.setErrorMode(false);
      expect(window.localStorage.getItem("planora.conversation")).toBe(before);
    });
  });

  it("retains a pending proposed action when its confirmed mutation fails", async () => {
    const conversation = await resolve(mockApiClient.sendChatMessage("create task to buy oranges"));
    const action = conversation.messages.at(-1)?.action;
    if (!action) throw new Error("Expected a create proposal");
    mockDevTools.setErrorMode(true);
    await expectApiError(
      mockApiClient.confirmChatAction(action.id),
      "SIMULATED_FAILURE",
      "Simulated failure while trying to create the task.",
    );
    mockDevTools.setErrorMode(false);
    const current = await resolve(mockApiClient.getCurrentConversation());
    expect(
      current.messages.find((message) => message.action?.id === action.id)?.action?.status,
    ).toBe("pending");
    expect(
      (await resolve(mockApiClient.listTasks())).some((task) => task.title === "Buy oranges"),
    ).toBe(false);
  });

  it("preserves current conversation, reset behavior, developer errors, and malformed storage fallbacks", async () => {
    window.localStorage.setItem("planora.settings", "not json");
    expect(await resolve(mockApiClient.getSettings())).toEqual({
      timezone: "Asia/Singapore",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    const current = await resolve(mockApiClient.getCurrentConversation());
    expect(current.messages).toEqual([]);
    expect(await resolve(mockApiClient.startNewConversation())).not.toBe(current);
    await resolve(mockApiClient.updateSettings({ timezone: "UTC" }));
    mockDevTools.setErrorMode(true);
    expect(mockDevTools.isErrorModeOn()).toBe(true);
    await expectApiError(
      mockApiClient.updateSettings({ modelName: "kimi-k3" }),
      "SIMULATED_FAILURE",
      "Simulated failure while trying to save settings.",
    );
    mockDevTools.setErrorMode(false);
    await resolve(mockApiClient.resetDemoData());
    expect(window.localStorage.getItem("planora.settings")).toBeNull();
    expect(window.localStorage.getItem("planora.conversation")).toBeNull();
    expect(storedTasks().length).toBeGreaterThan(0);
  });

  it("rejects a model outside the available models and keeps the stored one", async () => {
    await expectApiError(
      mockApiClient.updateSettings({ modelName: "not-served-model" }),
      "VALIDATION_ERROR",
      "Choose one of the available models.",
    );
    expect(await resolve(mockApiClient.getSettings())).toMatchObject({ modelName: "kimi-k3" });
  });

  it("uses browser-less storage fallbacks without throwing", async () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(await resolve(mockApiClient.getSession())).toBeNull();
      expect(await resolve(mockApiClient.getSettings())).toEqual({
        timezone: "Asia/Singapore",
        modelName: "kimi-k3",
        availableModels: ["kimi-k3"],
      });
      expect(await resolve(mockApiClient.listTasks())).toEqual([]);
      expect(await resolve(mockApiClient.getCurrentConversation())).toMatchObject({ messages: [] });
      await resolve(mockApiClient.resetDemoData());
      mockDevTools.setErrorMode(true);
      expect(mockDevTools.isErrorModeOn()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
