import { resolve } from "node:path";

/**
 * The one place that names every value the HTTP-mode smoke suite (#88)
 * hands to the API, the web dev server and the seeding helper.
 *
 * `run.ts` picks the run directory and both ports once, before Playwright
 * starts, and passes them down as `PLANORA_E2E_HTTP_*` variables (the same
 * pattern as `e2e/run.ts`, #66). Playwright reloads its config in every
 * worker, so nothing here may pick anything at import time.
 */
export const apiDir = resolve(import.meta.dirname, "../../api");
export const seedScript = resolve(import.meta.dirname, "seed.py");

export const USERNAME = "smoke";
export const PASSWORD = "smoke-password-1";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run the suite with \`bun run e2e:http\`.`);
  return value;
}

export function runSettings() {
  const dir = required("PLANORA_E2E_HTTP_DIR");
  const webOrigin = `http://127.0.0.1:${required("PLANORA_E2E_HTTP_WEB_PORT")}`;
  const apiOrigin = `http://127.0.0.1:${required("PLANORA_E2E_HTTP_API_PORT")}`;
  return { dir, webOrigin, apiOrigin, apiPort: required("PLANORA_E2E_HTTP_API_PORT") };
}

/**
 * Every configuration variable `Settings` reads, set explicitly so nothing
 * leaks in from the developer's shell. The API also runs with the run
 * directory as its cwd, so its `.env` lookup never sees `apps/api/.env`.
 * The LLM endpoint is the discard port: no request can leave the host.
 */
export function apiEnv(): Record<string, string> {
  const { dir, webOrigin } = runSettings();
  return {
    DATABASE_URL: `sqlite:///${dir}/planora.db`,
    SESSION_SECRET: "e2e-http-session-secret",
    LLM_BASE_URL: "http://127.0.0.1:9",
    LLM_API_KEY: "e2e-http-placeholder-key",
    LLM_MODEL: "kimi-k3",
    LLM_ALLOWED_MODELS: "",
    APP_ORIGIN: webOrigin,
    DEFAULT_TIMEZONE: "Asia/Singapore",
    LOG_LEVEL: "WARNING",
  };
}

export function uvArgs(...command: string[]): string[] {
  return ["run", "--project", apiDir, "--frozen", ...command];
}
