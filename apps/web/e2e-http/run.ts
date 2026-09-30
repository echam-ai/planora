import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { resolve } from "node:path";

import { getFreePort } from "../e2e/port";
import { PASSWORD, USERNAME, apiEnv, uvArgs } from "./env";

/**
 * Wraps `playwright test -c playwright.http.config.ts` for the HTTP-mode
 * smoke suite (#88). Follows `e2e/run.ts` (#66): free ports are picked once,
 * here, and handed to every Playwright process through the environment, and
 * termination signals are relayed to the child as SIGINT so Playwright tears
 * down both servers it started.
 *
 * On top of that it gives every run its own database: a new directory under
 * the repository's `.tmp/`, migrated with `alembic upgrade head` and seeded
 * with the single account before the API starts. Each command runs with that
 * directory as its cwd, which holds no `.env`, so a developer's
 * `apps/api/.env` is never read; `apiEnv()` supplies every setting instead.
 * The directory is removed after a passing run and kept, with its database,
 * after a failing one.
 */
const host = "127.0.0.1";
const repoRoot = resolve(import.meta.dirname, "../../..");
const scratch = resolve(repoRoot, ".tmp");
mkdirSync(scratch, { recursive: true });
const dir = mkdtempSync(resolve(scratch, "e2e-http-"));

const [apiPort, webPort] = [await getFreePort(host), await getFreePort(host)];
// `env.ts` reads these from this process's own environment too, and every
// child (setup commands, Playwright and its workers) inherits them.
process.env["PLANORA_E2E_HTTP_DIR"] = dir;
process.env["PLANORA_E2E_HTTP_API_PORT"] = String(apiPort);
process.env["PLANORA_E2E_HTTP_WEB_PORT"] = String(webPort);
const runEnv = { ...process.env };

function prepare(command: string[]) {
  const result = spawnSync("uv", uvArgs(...command), {
    cwd: dir,
    env: { ...runEnv, ...apiEnv() },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`e2e-http setup failed: uv ${command.join(" ")} (run directory kept: ${dir})`);
    process.exit(result.status ?? 1);
  }
}

prepare(["alembic", "-c", resolve(repoRoot, "apps/api/alembic.ini"), "upgrade", "head"]);
prepare(["python", resolve(import.meta.dirname, "seed.py"), "seed-user", USERNAME, PASSWORD]);

const child = spawn(
  "playwright",
  ["test", "-c", "playwright.http.config.ts", ...process.argv.slice(2)],
  { stdio: "inherit", env: runEnv },
);

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    child.kill("SIGINT");
  });
}

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    const signalNumber: number | undefined = (osConstants.signals as Record<string, number>)[
      signal
    ];
    process.exit(128 + (signalNumber ?? 0));
  }
  if (code === 0) rmSync(dir, { recursive: true, force: true });
  process.exit(code ?? 1);
});
