import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/types";
import { httpApiClient, createHttpApiClient } from "./httpApiClient";

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

describe("httpApiClient — profiles", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("reads the catalog with same-origin cookies and without profile context", async () => {
    const fetchSpy = stubFetch(
      jsonResponse(200, [
        { id: "hamster_knight", name: "Hamster Knight" },
        { id: "ech_princess", name: "Ech Princess" },
      ]),
    );
    expect(await httpApiClient.getProfiles()).toHaveLength(2);
    const { url, init } = lastRequest(fetchSpy);
    expect(url).toBe("/api/v1/profiles");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).has("X-Planora-Profile")).toBe(false);
  });
  it("captures the originating profile for every scoped endpoint", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, []));
    const knight = createHttpApiClient("hamster_knight"),
      princess = createHttpApiClient("ech_princess");
    await knight.listTasks();
    expect(new Headers(lastRequest(fetchSpy).init.headers).get("X-Planora-Profile")).toBe(
      "hamster_knight",
    );
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue(jsonResponse(200, []));
    await princess.listTasks();
    expect(new Headers(lastRequest(fetchSpy).init.headers).get("X-Planora-Profile")).toBe(
      "ech_princess",
    );
  });
  it("surfaces a missing profile validation error without fallback", async () => {
    stubFetch(jsonResponse(422, { code: "VALIDATION_ERROR", message: "Profile required." }));
    await expect(httpApiClient.listTasks()).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
    });
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

const wireConversation = {
  id: "c1",
  messages: [
    {
      id: "m1",
      role: "user",
      text: "Move 'Pay rent' to Done",
      created_at: "2026-09-28T10:00:00Z",
      action: null,
    },
    {
      id: "m2",
      role: "assistant",
      text: "I can move it.",
      created_at: "2026-09-28T10:00:01Z",
      action: {
        id: "a1",
        kind: "move",
        title: "Move task",
        summary: "Pay rent",
        fields: [{ label: "Status", from: "Todo", to: "Done" }],
        status: "pending",
        payload: { task_id: "t1", status: "done" },
      },
    },
  ],
};
const domainConversation = {
  id: "c1",
  messages: [
    { id: "m1", role: "user", text: "Move 'Pay rent' to Done", createdAt: "2026-09-28T10:00:00Z" },
    {
      id: "m2",
      role: "assistant",
      text: "I can move it.",
      createdAt: "2026-09-28T10:00:01Z",
      action: {
        id: "a1",
        kind: "move",
        title: "Move task",
        summary: "Pay rent",
        fields: [{ label: "Status", from: "Todo", to: "Done" }],
        status: "pending",
        payload: { taskId: "t1", status: "done" },
      },
    },
  ],
};

describe("httpApiClient — chat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("getCurrentConversation: GET /api/v1/chat/conversation, mapped", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, wireConversation));

    await expect(httpApiClient.getCurrentConversation()).resolves.toStrictEqual(domainConversation);
    const { url, init } = lastRequest(fetchSpy);
    expect(url).toBe("/api/v1/chat/conversation");
    expect(init.method).toBe("GET");
  });

  it("startNewConversation: POST /api/v1/chat/conversation with no body, mapped from the 201", async () => {
    const fetchSpy = stubFetch(jsonResponse(201, { id: "c2", messages: [] }));

    await expect(httpApiClient.startNewConversation()).resolves.toStrictEqual({
      id: "c2",
      messages: [],
    });
    const { url, init } = lastRequest(fetchSpy);
    expect(url).toBe("/api/v1/chat/conversation");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("Scenario: user receives a proposal — sendChatMessage posts exactly {text} and maps the result", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, wireConversation));

    const result = await httpApiClient.sendChatMessage("Move 'Pay rent' to Done");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const { url, init, body } = lastRequest(fetchSpy);
    expect(url).toBe("/api/v1/chat/messages");
    expect(init.method).toBe("POST");
    expect(Object.keys(body)).toEqual(["text"]);
    expect(body).toStrictEqual({ text: "Move 'Pay rent' to Done" });
    expect(result).toStrictEqual(domainConversation);
    expect("action" in result.messages[0]!).toBe(false);
  });

  it.each([
    ["confirmChatAction", "confirm"],
    ["rejectChatAction", "reject"],
  ] as const)(
    "%s: POST .../actions/{id}/%s with the id percent-encoded and no body",
    async (method, verb) => {
      const fetchSpy = stubFetch(jsonResponse(200, wireConversation));

      await expect(httpApiClient[method]("a/1 ?x")).resolves.toStrictEqual(domainConversation);

      const { url, init } = lastRequest(fetchSpy);
      expect(url).toBe(`/api/v1/chat/actions/a%2F1%20%3Fx/${verb}`);
      expect(init.method).toBe("POST");
      expect(init.body).toBeUndefined();
    },
  );

  it.each([
    [503, "AI_UNAVAILABLE", "The assistant is unavailable right now.", "sendChatMessage"],
    [404, "NOT_FOUND", "That proposed change is no longer available.", "confirmChatAction"],
    [
      409,
      "ACTION_ALREADY_REJECTED",
      "This change was cancelled, so it wasn't applied.",
      "confirmChatAction",
    ],
    [409, "ACTION_ALREADY_APPLIED", "This change has already been applied.", "rejectChatAction"],
    [409, "ACTION_STALE", "The task changed since this was proposed.", "confirmChatAction"],
  ] as const)(
    "%i %s rejects with an ApiError carrying code, status and message",
    async (status, code, message, method) => {
      stubFetch(jsonResponse(status, { code, message }));

      const promise = httpApiClient[method]("x");
      await expect(promise).rejects.toBeInstanceOf(ApiError);
      await expect(promise).rejects.toMatchObject({ code, status, message });
    },
  );
});

describe("httpApiClient — unavailable methods", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resetDemoData is the only method that rejects without calling fetch", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, {}));
    const args: Record<string, unknown[]> = {
      createTask: [{ title: "T", content: "", urls: [] }],
      updateTask: ["x", {}],
      moveTask: ["x", 0],
      reorderTasks: ["todo", []],
    };
    const others = Object.entries(httpApiClient).filter(([name]) => name !== "resetDemoData");
    expect(others.length).toBeGreaterThan(0);
    for (const [name, method] of others) {
      fetchSpy.mockClear();
      fetchSpy.mockResolvedValue(jsonResponse(200, null));
      await (method as (...a: unknown[]) => Promise<unknown>)(...(args[name] ?? ["x", "y"])).catch(
        () => undefined,
      );
      expect(fetchSpy, name).toHaveBeenCalled();
    }
  });

  it("resetDemoData rejects with NOT_SUPPORTED without calling fetch or deleting server data", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, {}));

    await expect(httpApiClient.resetDemoData()).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("httpApiClient — parseTaskText", () => {
  afterEach(() => vi.unstubAllGlobals());

  const text =
    "Prepare the search-quality review by Friday 4 PM. Use the experiment dashboard link.";

  it("Scenario: user parses free text — one POST with only {text}, mapped to a domain draft", async () => {
    const fetchSpy = stubFetch(
      jsonResponse(200, {
        title: "Prepare the search-quality review",
        content: "Review the experiment.",
        category: "work",
        priority: "high",
        deadline_at: "2026-10-02T08:00:00Z",
        urls: [{ url: "https://dash.example/exp", label: null }],
        markdown_note: "",
        unexpected: 1,
      }),
    );

    const draft = await httpApiClient.parseTaskText(text);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const { url, init, body } = lastRequest(fetchSpy);
    expect(url).toBe("/api/v1/ai/parse-task");
    expect(init.method).toBe("POST");
    expect(Object.keys(body)).toEqual(["text"]);
    expect(body.text).toBe(text);
    expect(draft).toStrictEqual({
      title: "Prepare the search-quality review",
      content: "Review the experiment.",
      category: "work",
      priority: "high",
      deadlineAt: "2026-10-02T08:00:00Z",
      urls: [{ id: expect.stringMatching(/.+/), url: "https://dash.example/exp" }],
      markdownNote: "",
    });
  });

  it("Scenario: assistant is unavailable — rejects with ApiError AI_UNAVAILABLE, 503 and the envelope message", async () => {
    stubFetch(
      jsonResponse(503, {
        code: "AI_UNAVAILABLE",
        message: "The assistant is unavailable right now.",
      }),
    );

    const promise = httpApiClient.parseTaskText("anything");
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      status: 503,
      message: "The assistant is unavailable right now.",
    });
  });

  it("rejects a 422 VALIDATION_ERROR with code, status and mapped details", async () => {
    stubFetch(
      jsonResponse(422, {
        code: "VALIDATION_ERROR",
        message: "Text is too long.",
        details: [{ field: "text", message: "Must be at most 4000 characters." }],
      }),
    );

    const promise = httpApiClient.parseTaskText("x".repeat(4001));
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      details: [{ field: "text", message: "Must be at most 4000 characters." }],
    });
  });
});

describe("httpApiClient — cancellation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["parseTaskText", "sendChatMessage"] as const)(
    "%s forwards the signal to fetch and rejects with an abort error, not an ApiError",
    async (method) => {
      const controller = new AbortController();
      const fetchSpy = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        expect(init.signal).toBe(controller.signal);
        expect(new Headers(init.headers).get("X-Planora-Profile")).toBe("hamster_knight");
        controller.abort();
        return Promise.reject(controller.signal.reason);
      });
      vi.stubGlobal("fetch", fetchSpy);

      const error = await createHttpApiClient("hamster_knight")
        [method]("Pending", controller.signal)
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ name: "AbortError" });
      expect(error).not.toBeInstanceOf(ApiError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["parseTaskText", "sendChatMessage"] as const)(
    "%s without a signal sends none (existing callers are unchanged)",
    async (method) => {
      const fetchSpy = vi.fn().mockRejectedValue(new TypeError("offline"));
      vi.stubGlobal("fetch", fetchSpy);

      await expect(createHttpApiClient("hamster_knight")[method]("Hi")).rejects.toMatchObject({
        code: "NETWORK_ERROR",
      });
      expect(fetchSpy.mock.calls[0]?.[1]).not.toHaveProperty("signal");
    },
  );
});

describe("httpApiClient — site password gate (#124)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("getAccess: GET /api/v1/auth/session, never carrying a profile", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, { authenticated: false }));
    await expect(createHttpApiClient("hamster_knight").getAccess()).resolves.toEqual({
      authenticated: false,
    });
    const { url, init } = lastRequest(fetchSpy);
    expect(url).toBe("/api/v1/auth/session");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("same-origin");
  });

  it("unlock: POST /api/v1/auth/login with the password as the JSON body", async () => {
    const fetchSpy = stubFetch(jsonResponse(200, { authenticated: true }));
    await expect(httpApiClient.unlock("a long passphrase")).resolves.toBeUndefined();
    const { url, init, body } = lastRequest(fetchSpy);
    expect(url).toBe("/api/v1/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(body).toEqual({ password: "a long passphrase" });
    expect(new Headers(init.headers).has("Origin")).toBe(false);
  });

  it("unlock surfaces INVALID_PASSWORD and RATE_LIMITED as ApiErrors", async () => {
    stubFetch(jsonResponse(401, { code: "INVALID_PASSWORD", message: "Incorrect password." }));
    await expect(httpApiClient.unlock("nope")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_PASSWORD",
    });
    stubFetch(
      jsonResponse(429, {
        code: "RATE_LIMITED",
        message: "Too many incorrect attempts. Try again later.",
      }),
    );
    await expect(httpApiClient.unlock("nope")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
    });
  });

  it("lock: POST /api/v1/auth/logout resolves on 204", async () => {
    const fetchSpy = stubFetch(noBodyResponse(204));
    await expect(httpApiClient.lock()).resolves.toBeUndefined();
    const { url, init } = lastRequest(fetchSpy);
    expect(url).toBe("/api/v1/auth/logout");
    expect(init.method).toBe("POST");
  });

  it("a gated route's 401 NOT_AUTHENTICATED surfaces as an ApiError", async () => {
    stubFetch(
      jsonResponse(401, { code: "NOT_AUTHENTICATED", message: "Authentication is required." }),
    );
    await expect(httpApiClient.getProfiles()).rejects.toMatchObject({
      status: 401,
      code: "NOT_AUTHENTICATED",
    });
  });
});
