import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/types";
import { request } from "./client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noBodyResponse(status: number): Response {
  return new Response(null, { status });
}

function htmlResponse(status: number, body = "<html>Bad Gateway</html>"): Response {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

describe("http/client request()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does no work at import time — fetch is untouched until request() runs", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.resetModules();

    await import("./client");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends a relative /api/v1 URL with same-origin credentials and an Accept header", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchSpy);

    await request({ method: "GET", path: "/tasks" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/v1/tasks",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.has("Origin")).toBe(false);
    expect(headers.has("Content-Type")).toBe(false);
    expect(init.body).toBeUndefined();
  });

  it("sends Content-Type and a JSON body for a request with a body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(201, { id: "1" }));
    vi.stubGlobal("fetch", fetchSpy);

    await request({ method: "POST", path: "/tasks", body: { title: "New" } });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ title: "New" }));
  });

  it("builds a query string with URLSearchParams, omitting undefined and empty values", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal("fetch", fetchSpy);

    await request({
      method: "GET",
      path: "/archive",
      query: { search: undefined, page: 2, page_size: 10 },
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/archive?page=2&page_size=10", expect.anything());
  });

  it("drops the query string entirely when every value is filtered out", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, []));
    vi.stubGlobal("fetch", fetchSpy);

    await request({ method: "GET", path: "/archive", query: { search: undefined } });

    expect(fetchSpy).toHaveBeenCalledWith("/api/v1/archive", expect.anything());
  });

  it("resolves a 204 to undefined without parsing a body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(noBodyResponse(204));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(request({ method: "DELETE", path: "/tasks/1" })).resolves.toBeUndefined();
  });

  it("resolves a 2xx JSON body to the parsed value", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { username: "demo" }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(request({ method: "GET", path: "/auth/session" })).resolves.toEqual({
      username: "demo",
    });
  });

  it.each([
    ["401 NOT_AUTHENTICATED", 401, "NOT_AUTHENTICATED", "Sign in required."],
    [
      "401 INVALID_CREDENTIALS",
      401,
      "INVALID_CREDENTIALS",
      "That username or password isn't right.",
    ],
    ["400 WRONG_PASSWORD", 400, "WRONG_PASSWORD", "Your current password is incorrect."],
    ["403 CSRF_ORIGIN_MISMATCH", 403, "CSRF_ORIGIN_MISMATCH", "Request origin was rejected."],
    ["404 NOT_FOUND", 404, "NOT_FOUND", "That task no longer exists."],
    ["429 RATE_LIMITED", 429, "RATE_LIMITED", "Too many attempts. Try again shortly."],
  ])("rejects with the shared ApiError for %s", async (_label, status, code, message) => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(status, { code, message }));
    vi.stubGlobal("fetch", fetchSpy);

    const promise = request({ method: "GET", path: "/tasks/1" });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ code, message, status });
  });

  it("maps 422 VALIDATION_ERROR details onto ApiError.details", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      jsonResponse(422, {
        code: "VALIDATION_ERROR",
        message: "Invalid request fields.",
        details: [{ field: "timezone", code: "VALUE_ERROR", message: "Not a known timezone." }],
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const promise = request({ method: "PATCH", path: "/settings", body: {} });
    await expect(promise).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      details: [{ field: "timezone", code: "VALUE_ERROR", message: "Not a known timezone." }],
    });
  });

  it("rejects with NETWORK_ERROR and a user-safe message when fetch itself rejects", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchSpy);

    const promise = request({ method: "GET", path: "/tasks" });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: "Can't reach Planora. Check your connection and try again.",
    });
  });

  it("rejects with UNEXPECTED_RESPONSE for a non-JSON, non-2xx body and never surfaces the HTML", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(htmlResponse(502));
    vi.stubGlobal("fetch", fetchSpy);

    const promise = request({ method: "GET", path: "/tasks" });
    await expect(promise).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE", status: 502 });
    const message = await promise.catch((e: unknown) => (e as ApiError).message);
    expect(message).not.toMatch(/<html>/i);
  });

  it("rejects with UNEXPECTED_RESPONSE for a non-2xx response with a completely empty body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(noBodyResponse(502));
    vi.stubGlobal("fetch", fetchSpy);

    const promise = request({ method: "GET", path: "/tasks" });
    await expect(promise).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE", status: 502 });
  });

  it("rejects with UNEXPECTED_RESPONSE when a 2xx body is not valid JSON", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const promise = request({ method: "GET", path: "/tasks" });
    await expect(promise).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE", status: 200 });
  });

  it("rejects with UNEXPECTED_RESPONSE when a 2xx body is empty but JSON was expected", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const promise = request({ method: "GET", path: "/tasks" });
    await expect(promise).rejects.toMatchObject({ code: "UNEXPECTED_RESPONSE", status: 200 });
  });
});
