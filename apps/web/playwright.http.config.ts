import { defineConfig, devices } from "@playwright/test";

import { apiEnv, runSettings, uvArgs } from "./e2e-http/env";

// The HTTP-mode smoke suite (#88): a real uvicorn API plus the web dev server
// in `VITE_API_MODE=http`, on a fresh migrated SQLite file, with free ports
// chosen once by `e2e-http/run.ts`. Kept apart from `playwright.config.ts`
// so `bun run e2e` never lists or runs it. Chromium only, one worker: every
// test shares one database and one account. No retries, default timeouts.
const { dir, webOrigin, apiOrigin, apiPort } = runSettings();
const webPort = new URL(webOrigin).port;

const WEB_SERVER_TIMEOUT_MS = 30_000;

export default defineConfig({
  testDir: "./e2e-http",
  testIgnore: "compose.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "html",
  use: { baseURL: webOrigin },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // cwd is the run directory, which holds no `.env`, so the developer's
      // apps/api/.env is never read: `Settings` sees only `apiEnv()`.
      command: [
        "uv",
        ...uvArgs(
          "uvicorn",
          "planora_api.main:create_app",
          "--factory",
          "--host",
          "127.0.0.1",
          "--port",
          apiPort,
        ),
      ].join(" "),
      cwd: dir,
      env: apiEnv(),
      url: `${apiOrigin}/api/v1/health`,
      reuseExistingServer: false,
      timeout: WEB_SERVER_TIMEOUT_MS,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `bun run dev -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      env: { VITE_API_MODE: "http", PLANORA_API_PROXY_TARGET: apiOrigin },
      url: webOrigin,
      reuseExistingServer: false,
      timeout: WEB_SERVER_TIMEOUT_MS,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
