import { expect, test } from "@playwright/test";
import { openTaskSheet, signIn } from "./helpers";
import { expectNoHorizontalScroll, expectSeparateBoxes, expectTouchTargets } from "./touch-targets";

// Sixteen states, on both projects; no mobile/desktop skips or weakened geometry checks.
test("touch targets: login", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Username")).toBeVisible();
  await expectTouchTargets(page, "1: login");
});

test("touch targets: filtered board and account menu", async ({ page }) => {
  await signIn(page);
  await page
    .getByRole("group", { name: "Category", exact: true })
    .getByRole("button", { name: "Work", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Clear all filters" })).toBeVisible();
  await expectTouchTargets(page, "2: filtered board");
  await expectNoHorizontalScroll(page, "2: filtered board");
  await page.getByRole("button", { name: "Clear all filters" }).click();
  for (const handle of await page.getByRole("button", { name: /^Drag / }).all()) {
    const title = handle.locator("..").getByRole("heading", { level: 3 });
    await expectSeparateBoxes(handle, title, "drag handle must be clear of each seed title");
  }
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  await expectTouchTargets(page, "3: account menu");
});

test("touch targets: quick capture, failed parse, form, calendar and category", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await expect(dialog).toBeVisible();
  await expectTouchTargets(page, "4: quick capture");
  await expectSeparateBoxes(
    dialog.getByRole("button", { name: "Close", exact: true }),
    dialog.getByRole("heading", { name: "Add a task" }),
    "dialog Close must be clear of its title",
  );
  await dialog.getByLabel("Describe the task in your own words").fill("fail to parse this task");
  await dialog.getByRole("button", { name: "Parse task" }).click();
  await expect(dialog.getByRole("button", { name: "Continue in the form instead" })).toBeVisible();
  await expectTouchTargets(page, "5: failed parse");
  await dialog.getByRole("tab", { name: "Task form" }).click();
  await expect(dialog.getByLabel("Date")).toBeVisible();
  await dialog.getByRole("button", { name: "Add link" }).click();
  await expect(dialog.getByRole("button", { name: "Remove link" })).toBeVisible();
  await expectTouchTargets(page, "6: task form with link row");
  await expectNoHorizontalScroll(page, "6: task form");
  await dialog.getByLabel("Date").click();
  await expect(page.locator('[data-slot="calendar"]')).toBeVisible();
  await expectTouchTargets(page, "7: date picker");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="calendar"]')).toBeHidden();
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await expect(page.getByRole("option", { name: "Work", exact: true })).toBeVisible();
  await expectTouchTargets(page, "8: Category select");
});

test("touch targets: task detail and delete confirmation", async ({ page }) => {
  await signIn(page);
  const dialog = await openTaskSheet(page, "Read chapter 4 of the distributed systems book");
  await expectTouchTargets(page, "9: task detail");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectTouchTargets(page, "10: delete confirmation");
});

test("touch targets: empty chat, proposal, new conversation and failed send", async ({ page }) => {
  await signIn(page);
  await page.getByRole("banner").getByRole("button", { name: "AI Assistant", exact: true }).click();
  await expect(page.getByText(/I never change anything without your confirmation/)).toBeVisible();
  await expectTouchTargets(page, "11: empty chat (desktop side panel or mobile drawer)");
  await expectNoHorizontalScroll(page, "11: empty chat");
  await page
    .getByRole("button", { name: "Add a task to review my notes tomorrow at 8 PM", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  await expectTouchTargets(page, "12: proposal card");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "Start a new conversation?" })).toBeVisible();
  await expectTouchTargets(page, "13: new conversation confirmation");
  await page.getByRole("button", { name: "Keep chat" }).click();
  await page.evaluate(() => window.localStorage.setItem("planora.forceError", "true"));
  await page.getByLabel("Message the assistant").fill("What is overdue?");
  await page.getByLabel("Message the assistant").press("Enter");
  await expect(page.getByText(/The assistant didn't respond/)).toBeVisible();
  await expectTouchTargets(page, "14: chat failure notice");
});

test("touch targets: archive and settings", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archive", exact: true })).toBeVisible();
  await expectTouchTargets(page, "15: archive");
  await page.getByRole("link", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("combobox", { name: "Timezone" })).toBeVisible();
  await expectTouchTargets(page, "16: settings");
});
