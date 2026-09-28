import { afterEach, describe, expect, it, vi } from "vitest";
import { startInstance } from "@/start";

// `createMiddleware().server(fn)` returns a rich typed object whose runtime
// shape (relevant here) is `{ options: { server: fn } }`; the full generic
// type isn't meant to be constructed by hand, so this narrows just the
// piece this test calls.
type RequestServerFn = (options: {
  next: () => Promise<{ response: Response } | Response>;
}) => Promise<{ response: Response } | Response>;

async function getErrorMiddlewareServer(): Promise<RequestServerFn> {
  const options = await startInstance.getOptions();
  const middleware = options.requestMiddleware?.[0] as unknown as {
    options: { server: RequestServerFn };
  };
  return middleware.options.server;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("start's error middleware", () => {
  it("passes a successful response through unchanged", async () => {
    const server = await getErrorMiddlewareServer();
    const ok = { response: new Response("ok", { status: 200 }) };

    const result = await server({ next: async () => ok });

    expect(result).toBe(ok);
  });

  it("rethrows an HTTP-status error instead of swallowing it", async () => {
    const server = await getErrorMiddlewareServer();
    const httpError = Object.assign(new Error("redirect"), { statusCode: 302 });

    await expect(server({ next: () => Promise.reject(httpError) })).rejects.toBe(httpError);
  });

  it("returns a 5xx error page without leaking the thrown error's message, and logs it once", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = await getErrorMiddlewareServer();
    const marker = "MARKER_a1b2c3_start";

    const result = await server({
      next: () => Promise.reject(new Error(`internal detail: ${marker}`)),
    });

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");

    const body = await response.text();
    expect(body).toContain("This page didn't load");
    expect(body).not.toContain(marker);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(String(consoleSpy.mock.calls[0]?.[0])).toContain(marker);
  });
});

describe("start's CSRF filter", () => {
  it("applies CSRF checks only to server-function requests, not ordinary page requests", async () => {
    const options = await startInstance.getOptions();
    const csrf = options.requestMiddleware?.[1] as unknown as {
      options: { server: (ctx: Record<string, unknown>) => Promise<unknown> };
    };

    // an ordinary page/router request bypasses CSRF validation entirely
    const routerNext = () => Promise.resolve("router-passthrough");
    const routerResult = await csrf.options.server({
      handlerType: "router",
      request: new Request("https://example.test/"),
      next: routerNext,
    });
    expect(routerResult).toBe("router-passthrough");

    // a server-function request from a foreign origin is rejected before `next` ever runs
    const serverFnNext = () => Promise.resolve("server-fn-passthrough");
    const crossOriginResult = await csrf.options.server({
      handlerType: "serverFn",
      request: new Request("https://example.test/api", {
        headers: { Origin: "https://evil.test" },
      }),
      next: serverFnNext,
    });
    expect(crossOriginResult).toBeInstanceOf(Response);
    expect((crossOriginResult as Response).status).toBe(403);

    // a server-function request from the same origin passes the CSRF check
    const sameOriginResult = await csrf.options.server({
      handlerType: "serverFn",
      request: new Request("https://example.test/api", {
        headers: { Origin: "https://example.test" },
      }),
      next: serverFnNext,
    });
    expect(sameOriginResult).toBe("server-fn-passthrough");
  });
});
