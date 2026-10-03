/**
 * A deterministic, loopback-only OpenAI-compatible provider for the HTTP-mode suite (#123).
 *
 * It listens on 127.0.0.1 only and never contacts anything, so no model traffic leaves the host.
 * `POST /chat/completions` is held until a test releases it, which is what lets a spec cancel
 * a request in the browser while the provider is provably still working:
 *
 *   GET  /control          every call so far: { id, capture, released, aborted }
 *   POST /release/:id      answer call `id`
 *   GET  /health           readiness probe for Playwright's webServer
 *
 * `capture` is true for quick capture (it asks for a `response_format`); the reply is then a
 * task draft, otherwise a plain chat reply. `aborted` becomes true when the API closes its
 * connection, i.e. when the cancellation reached the provider call.
 *
 * Runs under `bun` (see playwright.http.config.ts); `Bun` is declared locally because the
 * e2e tsconfig carries Node types only.
 */
declare const Bun: {
  serve(options: {
    hostname: string;
    port: number;
    idleTimeout: number;
    fetch(request: Request): Promise<Response>;
  }): { url: URL };
};

type Call = { capture: boolean; released: boolean; aborted: boolean; settle: () => void };

const calls = new Map<number, Call>();
let nextId = 0;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env["PLANORA_E2E_HTTP_LLM_PORT"]),
  idleTimeout: 120,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") return new Response("ok");
    if (pathname === "/control") {
      return Response.json(
        [...calls].map(([id, { capture, released, aborted }]) => ({
          id,
          capture,
          released,
          aborted,
        })),
      );
    }
    if (pathname.startsWith("/release/") && request.method === "POST") {
      const call = calls.get(Number(pathname.split("/").at(-1)));
      if (!call) return new Response("unknown call", { status: 404 });
      call.released = true;
      call.settle();
      return new Response("released");
    }
    if (pathname !== "/chat/completions" || request.method !== "POST") {
      return new Response("not found", { status: 404 });
    }

    const body = (await request.json()) as { response_format?: unknown };
    const id = ++nextId;
    const capture = Boolean(body.response_format);
    await new Promise<void>((settle) => {
      const call: Call = { capture, released: false, aborted: false, settle };
      calls.set(id, call);
      request.signal.addEventListener("abort", () => {
        call.aborted = true;
        settle();
      });
    });

    const content = capture
      ? JSON.stringify({
          title: `Fixture capture ${id}`,
          content: "Review this draft",
          category: "work",
          priority: "medium",
          deadline: null,
          urls: [],
        })
      : `Fixture chat ${id}`;
    return Response.json({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
    });
  },
});
console.log(`Delayed provider fixture on ${server.url}`);
