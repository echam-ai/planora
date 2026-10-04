import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getSelectedProfile, selectProfile, PROFILES } from "./profiles";
import { ACCESS_KEY } from "./mock/access";
import { createMockApiClient } from "./mockApiClient";
describe("profile selection and immutable mock scope", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ACCESS_KEY, "1");
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());
  it("allows the public catalog before selection while rejecting scoped reads and writes", async () => {
    const client = createMockApiClient(null);
    expect(await client.getProfiles()).toEqual(PROFILES);
    await expect(client.getSettings()).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
    await expect(
      client.createTask({
        title: "Must not be saved",
        content: "No profile",
        category: "other",
        priority: "medium",
        deadlineAt: null,
        urls: [],
        markdownNote: "",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    // Nothing but the unlocked-gate marker: no task, settings or chat data was written.
    expect(Object.keys(localStorage)).toEqual([ACCESS_KEY]);
    expect(getSelectedProfile()).toBeNull();
  });
  it("offers two names and rejects invalid selection", () => {
    expect(PROFILES.map((p) => p.name)).toEqual(["Hamster Knight", "Ech Princess"]);
    expect(getSelectedProfile()).toBeNull();
    localStorage.setItem("planora.profile", "unknown");
    expect(getSelectedProfile()).toBeNull();
    selectProfile("ech_princess");
    expect(getSelectedProfile()).toBe("ech_princess");
    selectProfile(null);
    expect(getSelectedProfile()).toBeNull();
  });
  it("migrates legacy data and isolates pending writes and settings", async () => {
    localStorage.setItem("planora.tasks", "[]");
    localStorage.setItem("planora.settings", JSON.stringify({ timezone: "UTC" }));
    const knight = createMockApiClient("hamster_knight"),
      princess = createMockApiClient("ech_princess");
    const initial = knight.listTasks();
    await vi.runAllTimersAsync();
    expect(await initial).toEqual([]);
    const pending = knight.createTask({
      title: "Knight only",
      content: "",
      category: "other",
      priority: "medium",
      deadlineAt: null,
      urls: [],
      markdownNote: "",
    });
    selectProfile("ech_princess");
    await vi.runAllTimersAsync();
    const task = await pending;
    const checks = Promise.all([
      princess.listTasks(),
      knight.getSettings(),
      princess.getSettings(),
      knight.getCurrentConversation(),
      princess.getCurrentConversation(),
    ]);
    await vi.runAllTimersAsync();
    const [tasks, ks, ps, kc, pc] = await checks;
    expect(tasks).toEqual([]);
    expect(ks.timezone).toBe("UTC");
    expect(ps.timezone).toBe("Asia/Singapore");
    expect(kc.id).not.toBe(pc.id);
    const rejected = expect(princess.getTask(task.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await vi.runAllTimersAsync();
    await rejected;
    const foreignReorder = expect(princess.reorderTasks("todo", [task.id])).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    const unknownReorder = expect(princess.reorderTasks("todo", ["unknown"])).rejects.toMatchObject(
      { code: "VALIDATION_ERROR", status: 422 },
    );
    await vi.runAllTimersAsync();
    await foreignReorder;
    await unknownReorder;
    const deletion = knight.deleteTask(task.id);
    await vi.runAllTimersAsync();
    await deletion;
    const empty = knight.listTasks();
    await vi.runAllTimersAsync();
    expect(await empty).toEqual([]);
  });
});

it("preserves legacy IDs, archive, messages/proposals and overrides only in Knight", async () => {
  localStorage.clear();
  localStorage.setItem(ACCESS_KEY, "1");
  vi.useFakeTimers();
  const task = {
    id: "legacy-id",
    title: "Legacy",
    content: "Kept",
    status: "done",
    category: "work",
    priority: "high",
    position: 9,
    createdAt: "2020-01-01T00:00:00Z",
    updatedAt: "2020-02-01T00:00:00Z",
    completedAt: "2020-02-01T00:00:00Z",
    archivedAt: "2020-03-01T00:00:00Z",
    deadlineAt: null,
    urls: [],
    markdownNote: "Note",
  };
  const conversation = {
    id: "legacy-conversation",
    messages: [
      {
        id: "message",
        role: "assistant",
        text: "Saved reply",
        createdAt: task.createdAt,
        action: {
          id: "proposal",
          kind: "move",
          title: "Move",
          summary: "Legacy",
          fields: [],
          status: "pending",
          payload: { taskId: task.id, status: "todo" },
        },
      },
    ],
  };
  localStorage.setItem("planora.tasks", JSON.stringify([task]));
  localStorage.setItem("planora.conversation", JSON.stringify(conversation));
  localStorage.setItem(
    "planora.settings",
    JSON.stringify({ timezone: "Europe/London", modelName: "kimi-k3" }),
  );
  const knight = createMockApiClient("hamster_knight"),
    princess = createMockApiClient("ech_princess");
  const values = Promise.all([
    knight.listArchive(),
    knight.getCurrentConversation(),
    knight.getSettings(),
    princess.listArchive(),
    princess.getCurrentConversation(),
    princess.getSettings(),
  ]);
  await vi.runAllTimersAsync();
  const [ka, kc, ks, pa, pc, ps] = await values;
  expect(ka.items).toEqual([task]);
  expect(kc).toEqual(conversation);
  expect(ks.timezone).toBe("Europe/London");
  expect(pa.items).toEqual([]);
  expect(pc.messages).toEqual([]);
  expect(ps.timezone).toBe("Asia/Singapore");
  expect(localStorage.getItem("planora.tasks")).toBeNull();
  const missing = expect(createMockApiClient(null).listTasks()).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
    status: 422,
  });
  await missing;
  vi.useRealTimers();
});
