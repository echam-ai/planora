import { defineConfig, devices } from "@playwright/test";

// A fixed port plus `reuseExistingServer` let one worktree's e2e run reuse
// or be torn down by another's (#66): whichever run started the server on
// 4173 first "owned" it, and the other tested against foreign code or hit
// ERR_CONNECTION_REFUSED once that run's server stopped.
//
// `e2e/run.ts` (invoked by `bun run e2e`, see package.json) asks the OS for
// a free port once per run and passes it down via these two env vars before
// spawning `playwright test`. Every worker process Playwright forks
// inherits that same environment, so they all agree on the one port
// `run.ts` also told `vite dev` to bind.
//
// The port is *not* picked here, in the config file itself: Playwright
// reloads `playwright.config.ts` independently in the main process and in
// every worker, so asking the OS for a free port at that point gave each
// process a different port — that mismatch, not the original defect, is
// what produced `ERR_CONNECTION_REFUSED` while this fix was being built.
//
// A direct `playwright test` invocation that skips the wrapper falls back
// to the previous fixed port 4173 and loses the multi-worktree isolation.
const host = process.env["PLAYWRIGHT_WEB_HOST"] ?? "127.0.0.1";
const port = Number(process.env["PLAYWRIGHT_WEB_PORT"] ?? 4173);
const baseURL = `http://${host}:${port}`;

// Cold-start measurement for #66 (apps/web, `rm -rf node_modules/.vite`,
// fresh `bun install`): `vite dev` reported "ready in 2823 ms" and answered
// its first HTTP request at ~5.8s. 30s is >5x that headroom for a slower
// CI runner while still failing well before Playwright's implicit 60s.
const WEB_SERVER_TIMEOUT_MS = 30_000;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    // --strictPort: if the port `run.ts` picked is somehow taken by the
    // time Vite binds (or a foreign server already holds it), Vite exits
    // instead of silently moving to another port — a diagnosable failure
    // rather than tests silently running against the wrong server.
    command: `bun run dev -- --host ${host} --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: WEB_SERVER_TIMEOUT_MS,
    stdout: "pipe",
    stderr: "pipe",
  },
});
