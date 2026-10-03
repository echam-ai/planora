import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { seedArchivedTask, seedTask } from "./db";

// The HTTP-mode smoke suite (#88): five flows against a real API and a fresh
// database, asserting on roles and visible text, never on browser storage.
// Every title is unique per run so a test never depends on another's rows.

type WireTask = {
  id: string;
  title: string;
  status: string;
  position: number;
  completed_at: string | null;
  archived_at: string | null;
};

function uniqueTitle(label: string): string {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Hamster Knight" }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
}

function column(page: Page, label: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: label }) });
}

function taskCard(page: Page, title: string) {
  return page.getByRole("button", { name: `Open task ${title}`, exact: true });
}

async function listTasks(request: APIRequestContext): Promise<WireTask[]> {
  const response = await request.get("/api/v1/tasks", {
    headers: { "X-Planora-Profile": "hamster_knight" },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as WireTask[];
}

async function addTaskThroughForm(page: Page, title: string) {
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await dialog.getByRole("tab", { name: "Task form" }).click();
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Content").fill("Created by the HTTP-mode smoke suite.");
  await dialog.getByRole("button", { name: "Create task" }).click();
  return dialog;
}

test("signs in through the login form against the real API", async ({ page, context }) => {
  await signIn(page);

  const cookies = await context.cookies();
  expect(cookies).toEqual([]);
});

test("creates a task that the server stores", async ({ page }) => {
  const title = uniqueTitle("Created task");
  await signIn(page);

  const dialog = await addTaskThroughForm(page, title);
  await expect(dialog).toBeHidden();
  await expect(
    column(page, "To do").getByRole("button", { name: `Open task ${title}` }),
  ).toBeVisible();

  await page.reload();
  await expect(
    column(page, "To do").getByRole("button", { name: `Open task ${title}` }),
  ).toBeVisible();

  const stored = (await listTasks(page.request)).find((task) => task.title === title);
  expect(stored?.status).toBe("todo");
});

test("moves a task to Done and the server records its completion", async ({ page }) => {
  const title = uniqueTitle("Completed task");
  seedTask(title, "todo");
  await signIn(page);

  await taskCard(page, title).click();
  const sheet = page.getByRole("dialog", { name: title });
  await sheet.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Done" }).click();
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();

  await page.reload();
  await expect(
    column(page, "Done").getByRole("button", { name: `Open task ${title}` }),
  ).toBeVisible();

  const stored = (await listTasks(page.request)).find((task) => task.title === title);
  expect(stored?.status).toBe("done");
  expect(stored?.completed_at).not.toBeNull();
});

test("restores a seeded archived task to the end of To do", async ({ page }) => {
  const earlier = uniqueTitle("Earlier task");
  const archived = uniqueTitle("Archived task");
  seedTask(earlier, "todo");
  seedArchivedTask(archived);
  await signIn(page);

  await page.getByRole("link", { name: "Archive" }).first().click();
  await expect(page.getByRole("heading", { name: "Archive", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `Open archived task ${archived}` })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("button", { name: `Open archived task ${archived}` })).toHaveCount(0);

  await page.getByRole("link", { name: "Active Tasks" }).first().click();
  const todoCards = column(page, "To do").getByRole("button", { name: /^Open task / });
  await expect(todoCards.last()).toHaveAccessibleName(`Open task ${archived}`);

  const tasks = await listTasks(page.request);
  const restored = tasks.find((task) => task.title === archived);
  expect(restored?.status).toBe("todo");
  expect(restored?.completed_at).toBeNull();
  expect(restored?.archived_at).toBeNull();
  expect(restored?.position).toBeGreaterThan(
    tasks.find((task) => task.title === earlier)?.position ?? Infinity,
  );
});

test("rejects missing profile and offers remembered selection without credentials", async ({
  page,
}) => {
  expect((await page.request.get("/api/v1/tasks")).status()).toBe(422);
  await signIn(page);
  await page.goto("/settings");
  await expect(page.getByRole("combobox", { name: "Timezone" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Selected account")).toHaveText("Hamster Knight");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ech Princess" })).toBeVisible();
});
