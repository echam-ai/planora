import { expect, test } from "@playwright/test";
import { profileFlows } from "../e2e/profile-flows";
import { unlock } from "../e2e/unlock";
import { seedArchivedTask } from "./db";
import { SITE_PASSWORD } from "./env";
profileFlows(SITE_PASSWORD);
test("archived details permanently delete a task after refresh", async ({ page }) => {
  const title = `Archived delete ${Date.now()}`;
  seedArchivedTask(title);
  await unlock(page, SITE_PASSWORD);
  await page.getByRole("button", { name: "Hamster Knight" }).click();
  await page.goto("/archive");
  await page.getByLabel("Search archived tasks").fill(title);
  const card = page.getByRole("button", { name: `Open archived task ${title}`, exact: true });
  await card.click();
  await page
    .getByRole("dialog", { name: title })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(title);
  await expect(confirm).toContainText("cannot be undone");
  await confirm.getByRole("button", { name: "Delete task" }).click();
  await expect(confirm).toBeHidden();
  await expect(card).toHaveCount(0);
  await page.reload();
  await page.getByLabel("Search archived tasks").fill(title);
  await expect(card).toHaveCount(0);
});
test("a delayed write retains Knight context and cannot enter Princess views", async ({ page }) => {
  await unlock(page, SITE_PASSWORD);
  await page.getByRole("button", { name: "Hamster Knight" }).click();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/v1/tasks", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect(route.request().headers()["x-planora-profile"]).toBe("hamster_knight");
    started();
    await gate;
    await route.continue();
  });
  const title = `Pending Knight ${Date.now()}`;
  await page.getByRole("button", { name: "Add task" }).click();
  const form = page.getByRole("dialog", { name: "Add a task" });
  await form.getByRole("tab", { name: "Task form" }).click();
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Content").fill("Pending");
  await form.getByRole("button", { name: "Create task" }).click();
  await requestStarted;
  // Client navigation keeps the originating request alive while the old tree unmounts.
  await page.evaluate(() => {
    history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.getByRole("button", { name: "Ech Princess" }).click();
  await expect(page.getByLabel("Selected account")).toHaveText("Ech Princess");
  const completed = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/tasks",
  );
  release();
  expect((await completed).status()).toBe(201);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Open task ${title}`, exact: true })).toHaveCount(
    0,
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Hamster Knight" }).click();
  await expect(page.getByRole("button", { name: `Open task ${title}`, exact: true })).toBeVisible();
});
