import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/types";
import { httpApiClient } from "./httpApiClient";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noBodyResponse(status: number): Response {
  return new Response(null, { status });
}

function stubFetch(response: Response) {
  const fetchSpy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function lastRequest(fetchSpy: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(init.body as string) : undefined };
}

describe("httpApiClient — auth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("login: POST /api/v1/auth/login with credentials, resolving the session", async () => {
    const fetchSpy = stubFetch(
      jsonResponse(200, { username: "owner", signed_in_at: "2026-09-28T10:00:00+00:00" }),
    );

    const session = await httpApiClient.login("owner", "pw");

    const { url, init, body } = lastRequest(fetchSpy);
    expect(url).toBe("/api/v1/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(body).toEqual({ username: "owner", password: "pw" });
    expect(session).toEqual({ username: "owner", signedInAt: "2026-09-28T10:00:00+00:00" });
  });

  it("logout: POST /api/v1/auth/logout, expects 204", async () => {
    const fetchSpy = stubFetch(noBodyResponse(204));

    await expect(httpApiClient.logout()).resolves.toBeUndefined();
    expect(lastRequest(fetchSpy).url).toBe("/api/v1/auth/logout");
    expect(lastRequest(fetchSpy).init.method).toBe("POST");
  });

  it("getSession: GET /api/v1/auth/session, mapping null to null", async () => {
    stubFetch(jsonResponse(200, null));
    await expect(httpApiClient.getSession()).resolves.toBeNull();
  });

  it("getSession: maps a session body to camelCase", async () => {
    stubFetch(jsonResponse(200, { username: "owner", signed_in_at: "2026-09-28T10:00:00+00:00" }));
    await expect(httpApiClient.getSession()).resolves.toEqual({
      username: "owner",
      signedInAt: "2026-09-28T10:00:00+00:00",
    });
  });

  it("Scenario: session expires mid-use — listTasks rejects with ApiError NOT_AUTHENTICATED, status 401", async () => {
    stubFetch(jsonResponse(401, { code: "NOT_AUTHENTICATED", message: "Sign in required." }));

    const promise = httpApiClient.listTasks();
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ code: "NOT_AUTHENTICATED", status: 401 });
  });
});

describe("httpApiClient — settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("getSettings: GET /api/v1/settings", async () => {
    const fetchSpy = stubFetch(
      jsonResponse(200, {
        timezone: "UTC",
        model_name: "kimi-k3",
        available_models: ["kimi-k3"],
      }),
    );

    await expect(httpApiClient.getSettings()).resolves.toEqual({
      timezone: "UTC",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    expect(lastRequest(fetchSpy).url).toBe("/api/v1/settings");
    expect(lastRequest(fetchSpy).init.method).toBe("GET");
  });

  it("updateSettings: PATCH /api/v1/settings with only the provided fields", async () => {
    const fetchSpy = stubFetch(
      jsonResponse(200, {
        timezone: "Asia/Singapore",
        model_name: "kimi-k3",
        available_models: ["kimi-k3"],
      }),
    );

    await httpApiClient.updateSettings({ timezone: "Asia/Singapore" });

    const { init, body } = lastRequest(fetchSpy);
    expect(init.method).toBe("PATCH");
    expect(body).toEqual({ timezone: "Asia/Singapore" });
  });

  it("changePassword: POST /api/v1/settings/password, expects 204", async () => {
    const fetchSpy = stubFetch(noBodyResponse(204));

    await httpApiClient.changePassword("old", "new");

    const { url, init, body } = lastRequest(fetchSpy);
    expect(url).toBe("/api/v1/settings/password");
    expect(init.method).toBe("POST");
    expect(body).toEqual({ current_password: "old", new_password: "new" });
  });

  it("Scenario: validation error carries field details", async () => {
    stubFetch(
      jsonResponse(422, {
        code: "VALIDATION_ERROR",
        message: "Invalid request fields.",
        details: [{ field: "timezone", code: "VALUE_ERROR", message: "Not a known timezone." }],
      }),
    );

    let caught: ApiError | undefined;
    try {
      await httpApiClient.updateSettings({ timezone: "Nowhere" });
    } catch (e) {
      caught = e as ApiError;
    }

    expect(caught).toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(caught?.details?.[0]).toEqual({
      field: "timezone",
      code: "VALUE_ERROR",
      message: "Not a known timezone.",
    });
  });
});

describe("httpApiClient — tasks", () => {
  afterEach(() => vi.unstubAllGlobals());

  const wireTask = {
    id: "task-1",
    title: "T",
    content: "C",
    category: "work",
    priority: "medium",
    status: "todo",
    deadline_at: null,
    urls: [],
    markdown_note: "",
    position: 0,
    created_at: "2026-09-01T00:00:00+00:00",
    updated_at: "2026-09-01T00:00:00+00:00",
    completed_at: null,
    archived_at: null,
  };

  it("listTasks: GET /api/v1/tasks", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, [wireTask]));

    const tasks = await httpApiClient.listTasks();

    expect(lastRequest(fetchSpy).url).toBe("/api/v1/tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.id).toBe("task-1");
  });

  it("getTask: GET /api/v1/tasks/{id}, url-encoded", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, wireTask));

    await httpApiClient.getTask("task 1/x");

    expect(lastRequest(fetchSpy).url).toBe("/api/v1/tasks/task%201%2Fx");
  });

  it("createTask: POST /api/v1/tasks, resolving the 201 body", async () => {
    const fetchSpy = stubFetch(jsonResponse(201, wireTask));

    const task = await httpApiClient.createTask({
      title: "T",
      content: "C",
      category: "work",
      priority: "medium",
      deadlineAt: null,
      markdownNote: "",
      urls: [],
    });

    expect(lastRequest(fetchSpy).init.method).toBe("POST");
    expect(lastRequest(fetchSpy).body).toMatchObject({ title: "T", status: "todo" });
    expect(task.id).toBe("task-1");
  });

  it("updateTask: PATCH /api/v1/tasks/{id} with only the provided fields", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, wireTask));

    await httpApiClient.updateTask("task-1", { title: "Renamed" });

    expect(lastRequest(fetchSpy).url).toBe("/api/v1/tasks/task-1");
    expect(lastRequest(fetchSpy).init.method).toBe("PATCH");
    expect(lastRequest(fetchSpy).body).toEqual({ title: "Renamed" });
  });

  it("deleteTask: DELETE /api/v1/tasks/{id}, expects 204", async () => {
    const fetchSpy = stubFetch(noBodyResponse(204));

    await expect(httpApiClient.deleteTask("task-1")).resolves.toBeUndefined();
    expect(lastRequest(fetchSpy).init.method).toBe("DELETE");
  });

  it("moveTask: POST /api/v1/tasks/{id}/move with {status, index}, resolving the active-task array", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, [wireTask]));

    const tasks = await httpApiClient.moveTask("task-1", "done", 2);

    expect(lastRequest(fetchSpy).url).toBe("/api/v1/tasks/task-1/move");
    expect(lastRequest(fetchSpy).body).toEqual({ status: "done", index: 2 });
    expect(tasks).toHaveLength(1);
  });

  it("reorderTasks: POST /api/v1/tasks/reorder with {status, ordered_ids}", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, [wireTask]));

    await httpApiClient.reorderTasks("todo", ["a", "b"]);

    expect(lastRequest(fetchSpy).url).toBe("/api/v1/tasks/reorder");
    expect(lastRequest(fetchSpy).body).toEqual({ status: "todo", ordered_ids: ["a", "b"] });
  });

  it("Scenario: task round trip keeps url ids stable, drops them on the way out", async () => {
    const taskWithUrls = {
      ...wireTask,
      urls: [
        { url: "https://a", label: "A" },
        { url: "https://b", label: null },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, taskWithUrls))),
    );

    const first = await httpApiClient.getTask("task-1");
    const second = await httpApiClient.getTask("task-1");

    expect(first.urls.map((u) => u.id)).toEqual(second.urls.map((u) => u.id));
    expect(second.urls[1]!.label).toBeUndefined();

    const fetchSpy = stubFetch(jsonResponse(200, wireTask));
    await httpApiClient.updateTask("task-1", { urls: second.urls });
    expect(lastRequest(fetchSpy).body.urls).toEqual([
      { url: "https://a", label: "A" },
      { url: "https://b" },
    ]);
  });
});

describe("httpApiClient — archive", () => {
  afterEach(() => vi.unstubAllGlobals());

  const wireTask = {
    id: "task-1",
    title: "T",
    content: "C",
    category: "work",
    priority: "medium",
    status: "done",
    deadline_at: null,
    urls: [],
    markdown_note: "",
    position: 0,
    created_at: "2026-09-01T00:00:00+00:00",
    updated_at: "2026-09-01T00:00:00+00:00",
    completed_at: "2026-09-02T00:00:00+00:00",
    archived_at: "2026-09-03T00:00:00+00:00",
  };

  it("listArchive: GET /api/v1/archive?search=…&page=…&page_size=10, omitting an empty search", async () => {
    const fetchSpy = stubFetch(
      jsonResponse(200, { items: [wireTask], total: 1, page: 1, page_size: 10 }),
    );

    const page = await httpApiClient.listArchive("", 1);

    expect(lastRequest(fetchSpy).url).toBe("/api/v1/archive?page=1&page_size=10");
    expect(page).toEqual({
      items: [expect.objectContaining({ id: "task-1" })],
      total: 1,
      page: 1,
      pageSize: 10,
    });
  });

  it("listArchive: includes a non-empty search term", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, { items: [], total: 0, page: 1, page_size: 10 }));

    await httpApiClient.listArchive("urgent", 2);

    expect(lastRequest(fetchSpy).url).toBe("/api/v1/archive?search=urgent&page=2&page_size=10");
  });

  it("getArchivedTask: GET /api/v1/archive/{id}", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, wireTask));

    await httpApiClient.getArchivedTask("task-1");

    expect(lastRequest(fetchSpy).url).toBe("/api/v1/archive/task-1");
  });

  it("restoreTask: POST /api/v1/archive/{id}/restore", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, wireTask));

    const task = await httpApiClient.restoreTask("task-1");

    expect(lastRequest(fetchSpy).url).toBe("/api/v1/archive/task-1/restore");
    expect(lastRequest(fetchSpy).init.method).toBe("POST");
    expect(task.id).toBe("task-1");
  });

  it("permanentlyDeleteTask: DELETE /api/v1/archive/{id}, expects 204", async () => {
    const fetchSpy = stubFetch(noBodyResponse(204));

    await expect(httpApiClient.permanentlyDeleteTask("task-1")).resolves.toBeUndefined();
    expect(lastRequest(fetchSpy).init.method).toBe("DELETE");
  });

  it("Scenario: an unknown archive id rejects with NOT_FOUND", async () => {
    stubFetch(
      jsonResponse(404, { code: "NOT_FOUND", message: "That archived task no longer exists." }),
    );

    await expect(httpApiClient.getArchivedTask("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

describe("httpApiClient — unavailable methods", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("Scenario: chat is not wired yet — sendChatMessage rejects with AI_UNAVAILABLE and never calls fetch", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, {}));

    await expect(httpApiClient.sendChatMessage("hi")).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parseTaskText rejects with AI_UNAVAILABLE without calling fetch", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, {}));

    await expect(httpApiClient.parseTaskText("do the thing tomorrow")).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["getCurrentConversation", () => httpApiClient.getCurrentConversation()],
    ["startNewConversation", () => httpApiClient.startNewConversation()],
    ["confirmChatAction", () => httpApiClient.confirmChatAction("action-1")],
    ["rejectChatAction", () => httpApiClient.rejectChatAction("action-1")],
  ])("%s rejects with AI_UNAVAILABLE without calling fetch", async (_name, call) => {
    const fetchSpy = stubFetch(jsonResponse(200, {}));

    await expect(call()).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("resetDemoData rejects with NOT_SUPPORTED without calling fetch or deleting server data", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, {}));

    await expect(httpApiClient.resetDemoData()).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
