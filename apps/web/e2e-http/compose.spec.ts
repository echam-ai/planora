import { expect, test } from "@playwright/test";

import { unlock } from "../e2e/unlock";

// The disposable stack's `APP_PASSWORD` (docs/ops/compose-stack.md). The spec types it on the
// password page like a visitor and never logs it.
function sitePassword(): string {
  const value = process.env["PLANORA_E2E_COMPOSE_PASSWORD"];
  if (!value)
    throw new Error("PLANORA_E2E_COMPOSE_PASSWORD is required for the disposable Compose check.");
  return value;
}

// An already initialized disposable Compose project owns its lifecycle and
// PostgreSQL data. These checks use only Caddy's public origin, never a dev
// server, direct API port, local SQLite helper, or LLM request.
test("Caddy serves web assets and preserves API routing", async ({ page, request }) => {
  for (const path of ["/health", "/api/v1/health"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  }

  // The site-password gate runs before routing, so a request without the cookie to an unknown
  // `/api/v1/*` path is 401 API JSON, not web HTML: Caddy still routes it to the API.
  const missing = await request.get("/api/v1/compose-smoke-missing");
  expect(missing.status()).toBe(401);
  expect(missing.headers()["content-type"]).toContain("application/json");
  expect(await missing.json()).toMatchObject({ code: "NOT_AUTHENTICATED" });

  const assetResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.startsWith("/assets/"),
  );
  await page.goto("/login");
  expect((await assetResponse).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();

  // Behind Caddy the data routes answer 401 until the browser has unlocked.
  const locked = await request.get("/api/v1/profiles");
  expect(locked.status()).toBe(401);
  expect(await locked.json()).toMatchObject({ code: "NOT_AUTHENTICATED" });
});

test("unlocks and writes a task through one origin while preserving CSRF protection", async ({
  page,
  context,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const apiOrigins = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/")) apiOrigins.add(url.origin);
  });
  const title = `Compose task ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await unlock(page, sitePassword());
  await page.getByRole("button", { name: "Hamster Knight" }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();

  const cookies = await context.cookies();
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatchObject({ name: "planora_access", httpOnly: true, sameSite: "Lax" });

  // Once unlocked, an unknown `/api/v1/*` path reaches the API router and gets its 404 JSON.
  const missing = await page.request.get("/api/v1/compose-smoke-missing");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");
  expect(await missing.json()).toMatchObject({ code: "NOT_FOUND" });

  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await dialog.getByRole("tab", { name: "Task form" }).click();
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Content").fill("Created through the production Caddy origin.");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();
  const card = page.getByRole("button", { name: `Open task ${title}`, exact: true });
  await expect(card).toBeVisible();
  await page.reload();
  await expect(card).toBeVisible();

  const listed = await page.request.get("/api/v1/tasks", {
    headers: { "X-Planora-Profile": "hamster_knight" },
  });
  expect(listed.status()).toBe(200);
  const tasks = (await listed.json()) as Array<{ id: string; title: string; content: string }>;
  const stored = tasks.find((task) => task.title === title);
  expect(stored).toBeDefined();

  for (const headers of [{ Origin: "http://wrong-origin.invalid" }, {}]) {
    const rejected = await page.request.patch(`/api/v1/tasks/${stored!.id}`, {
      headers: { ...headers, "X-Planora-Profile": "hamster_knight" },
      data: { content: "Rejected origin must not overwrite this task." },
    });
    expect(rejected.status()).toBe(403);
    expect(await rejected.json()).toMatchObject({ code: "CSRF_ORIGIN_MISMATCH" });
  }

  await card.click();
  const sheet = page.getByRole("dialog", { name: title });
  await expect(sheet.getByLabel("Content")).toHaveValue(stored!.content);
  await sheet.getByLabel("Content").fill("Updated through Caddy.");
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  await card.click();
  await expect(sheet.getByLabel("Content")).toHaveValue("Updated through Caddy.");
  await sheet.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete task", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(card).toHaveCount(0);
  const remaining = await page.request.get("/api/v1/tasks", {
    headers: { "X-Planora-Profile": "hamster_knight" },
  });
  expect(remaining.status()).toBe(200);
  expect((await remaining.json()) as Array<{ id: string }>).not.toContainEqual(
    expect.objectContaining({ id: stored!.id }),
  );
  expect([...apiOrigins]).toEqual([origin]);
});
