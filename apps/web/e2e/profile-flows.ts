import { expect, test, type Page } from "@playwright/test";
import { expectHydrated } from "./hydration";
async function choose(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  await expect(page.getByLabel("Selected account")).toHaveText(name);
}
async function switchAccount(page: Page, name: string) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Switch account" }).click();
  await expect(page.getByRole("heading", { name: "Choose your account" })).toBeVisible();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByLabel("Selected account")).toHaveText(name);
}
async function create(page: Page, title: string) {
  await page.getByRole("button", { name: "Add task" }).click();
  const form = page.getByRole("dialog", { name: "Add a task" });
  await form.getByRole("tab", { name: "Task form" }).click();
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Content").fill("Profile flow");
  await form.getByRole("button", { name: "Create task" }).click();
  await expect(form).toBeHidden();
}
export function profileFlows() {
  test("chooser and remembered deep links preserve tasks after refresh", async ({
    page,
    context,
  }) => {
    await page.goto("/tasks");
    // Vite's cold module graph can outlive the document load event. Start
    // the chooser assertion only once React can run the profile guard.
    await expectHydrated(page, "main");
    await expect(page.getByRole("button", { name: "Hamster Knight" })).toBeVisible();
    expect(await context.cookies()).toEqual([]);
    await choose(page, "Hamster Knight");
    const title = `Knight ${Date.now()}`;
    await create(page, title);
    await page.reload();
    await expect(
      page.getByRole("button", { name: `Open task ${title}`, exact: true }),
    ).toBeVisible();
    for (const path of ["/archive", "/settings"]) {
      await page.goto(path);
      await expect(page.getByLabel("Selected account")).toHaveText("Hamster Knight");
    }
  });
  test("account switching isolates tasks and discards unsaved drafts", async ({ page }) => {
    await choose(page, "Hamster Knight");
    const title = `Knight ${Date.now()}`;
    await create(page, title);
    await page.goto("/tasks");
    await page.getByRole("button", { name: `Open task ${title}`, exact: true }).click();
    await page.getByRole("dialog").getByLabel("Title").fill("Unsaved draft");
    await page.goto("/");
    await page.getByRole("button", { name: "Ech Princess" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Open task ${title}`, exact: true })).toHaveCount(
      0,
    );
    const princess = `Princess ${Date.now()}`;
    await create(page, princess);
    await switchAccount(page, "Hamster Knight");
    await expect(
      page.getByRole("button", { name: `Open task ${title}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Open task ${princess}`, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Open task Unsaved draft", exact: true }),
    ).toHaveCount(0);
  });
  test("legacy login links and invalid remembered profiles return to the chooser", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem("planora.profile") === null)
        localStorage.setItem("planora.profile", "hamster_knight");
    });
    await page.goto("/login");
    await expectHydrated(page, "main");
    await expect(page.getByRole("button", { name: "Ech Princess" })).toBeVisible();
    await page.evaluate(() => localStorage.setItem("planora.profile", "unknown"));
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Choose your account" })).toBeVisible();
  });
  for (const status of ["To do", "In Progress", "Done"] as const) {
    test(`permanent deletion from ${status} detail cancels and persists after keyboard confirmation`, async ({
      page,
    }) => {
      await choose(page, "Hamster Knight");
      const title = `Delete ${status} ${Date.now()}`;
      await create(page, title);
      const card = page.getByRole("button", { name: `Open task ${title}`, exact: true });
      await card.click();
      let detail = page.getByRole("dialog", { name: title });
      if (status !== "To do") {
        await detail.getByRole("combobox", { name: "Status" }).click();
        await page.getByRole("option", { name: status, exact: true }).click();
        await detail.getByRole("button", { name: "Save changes" }).click();
        await expect(detail).toBeHidden();
        await card.click();
        detail = page.getByRole("dialog", { name: title });
      }
      await detail.getByRole("button", { name: "Delete", exact: true }).click();
      const confirm = page.getByRole("alertdialog");
      await expect(confirm.getByRole("heading")).toContainText(title);
      await expect(confirm).toContainText("cannot be undone");
      await confirm.getByRole("button", { name: "Keep task" }).press("Enter");
      await expect(confirm).toBeHidden();
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: "Delete", exact: true }).click();
      await confirm.getByRole("button", { name: "Delete task", exact: true }).press("Enter");
      await expect(confirm).toBeHidden();
      await expect(detail).toBeHidden();
      await expect(card).toHaveCount(0);
      await page.reload();
      await expect(card).toHaveCount(0);
    });
  }
}
