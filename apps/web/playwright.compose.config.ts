import { defineConfig, devices } from "@playwright/test";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the disposable Compose browser check.`);
  return value;
}

const origin = required("PLANORA_E2E_COMPOSE_ORIGIN");
const url = new URL(origin);
if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
  throw new Error("PLANORA_E2E_COMPOSE_ORIGIN must be an HTTP(S) origin without a path.");
}

// The operator starts and initializes a disposable stack first. Playwright
// deliberately starts no server and performs no database/Compose operations.
export default defineConfig({
  testDir: "./e2e-http",
  testMatch: "compose.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: origin },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
