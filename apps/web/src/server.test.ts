import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("@tanstack/react-start/server-entry", () => ({
  default: { fetch: fetchMock },
}));

type ServerEntry = { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };

async function importServerEntry(): Promise<ServerEntry> {
  const mod = await import("@/server");
  return mod.default as ServerEntry;
}

function request() {
  return new Request("https://example.test/");
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("server entry: ordinary responses", () => {
  it("passes a successful response through unchanged", async () => {
    const entry = await importServerEntry();
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const response = await entry.fetch(request(), {}, {});

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("handles repeated requests through the same (cached) server entry import", async () => {
    const entry = await importServerEntry();
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const first = await entry.fetch(request(), {}, {});
    const second = await entry.fetch(request(), {}, {});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("passes a 5xx response with no content-type header through unchanged", async () => {
    const entry = await importServerEntry();
    const upstream = new Response("no content-type here", { status: 500 });
    upstream.headers.delete("content-type"); // Response auto-sets text/plain for a string body
    fetchMock.mockResolvedValue(upstream);

    const response = await entry.fetch(request(), {}, {});

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBeNull();
    expect(await response.text()).toBe("no content-type here");
  });

  it("passes a non-JSON 5xx response through without inspecting its body", async () => {
    const entry = await importServerEntry();
    fetchMock.mockResolvedValue(
      new Response("plain text failure", {
        status: 502,
        headers: { "content-type": "text/plain" },
      }),
    );

    const response = await entry.fetch(request(), {}, {});

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("plain text failure");
  });

  it("passes a JSON 5xx response through when its shape isn't h3's swallowed-error shape", async () => {
    const entry = await importServerEntry();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ foo: "bar" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await entry.fetch(request(), {}, {});

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"foo":"bar"}');
  });

  it("passes a JSON-content-typed 5xx response through when the body isn't valid JSON", async () => {
    const entry = await importServerEntry();
    fetchMock.mockResolvedValue(
      new Response("not actually json", {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await entry.fetch(request(), {}, {});

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("not actually json");
  });
});

describe("server entry: h3-swallowed errors are normalized to the generic error page", () => {
  it("logs the previously-captured error and hides it from the response body", async () => {
    const entry = await importServerEntry();

    // Record a capture the way error-capture.ts's patched console.error
    // does in real use, by calling console.error before it's mocked out.
    const captured = new Error("MARKER_swallow_captured detail");
    console.error(captured);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ unhandled: true, message: "HTTPError" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await entry.fetch(request(), {}, {});

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("This page didn't load");
    expect(body).not.toContain("MARKER_swallow_captured");

    expect(consoleSpy).toHaveBeenCalledWith(captured);
  });

  it("logs a synthesized error with no prior capture, without leaking the swallowed body", async () => {
    const entry = await importServerEntry();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const swallowedBody = JSON.stringify({ unhandled: true, message: "HTTPError" });
    fetchMock.mockResolvedValue(
      new Response(swallowedBody, {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await entry.fetch(request(), {}, {});

    const body = await response.text();
    expect(body).toContain("This page didn't load");
    expect(body).not.toContain("unhandled");

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = consoleSpy.mock.calls[0]?.[0];
    expect(logged).toBeInstanceOf(Error);
    expect((logged as Error).message).toContain(swallowedBody);
  });
});

describe("server entry: an error thrown by the wrapped handler", () => {
  it("returns a 5xx error page without leaking the error's message, and logs it once", async () => {
    const entry = await importServerEntry();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const marker = "MARKER_f9e8d7_server";
    fetchMock.mockRejectedValue(new Error(`internal detail: ${marker}`));

    const response = await entry.fetch(request(), {}, {});

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const body = await response.text();
    expect(body).toContain("This page didn't load");
    expect(body).not.toContain(marker);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = consoleSpy.mock.calls[0]?.[0];
    expect(logged).toBeInstanceOf(Error);
    expect((logged as Error).message).toContain(marker);
  });
});
