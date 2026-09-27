import { expect, test } from "@playwright/test";
import { card, openTaskSheet, signIn } from "./helpers";

test("signs in and shows the three board columns", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("focusboard");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("link", { name: "Active Tasks" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "In progress" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
});

test("combines multi-select board filters and clears them by keyboard", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("focusboard");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByLabel("Search tasks").fill("RaFt");
  await expect(
    page.getByRole("button", { name: "Open task Read chapter 4 of the distributed systems book" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open task Renew passport" })).toBeHidden();
  await page.getByLabel("Search tasks").fill("");

  const work = page.getByRole("button", { name: "Work" });
  const personal = page.getByRole("button", { name: "Personal" });
  await expect(page.getByRole("group", { name: "Category" })).toBeVisible();
  await work.focus();
  await page.keyboard.press("Space");
  await personal.press("Enter");
  await page.getByRole("button", { name: "High" }).click();
  await page.getByRole("button", { name: "Low" }).click();
  await page.getByRole("button", { name: "Scheduled" }).click();
  await page.getByRole("button", { name: "Overdue" }).click();

  await expect(work).toHaveAttribute("aria-pressed", "true");
  await expect(personal).toHaveAttribute("aria-pressed", "true");
  await expect(work.locator("svg")).toBeVisible();
  await expect(personal.locator("svg")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open task Ship the search-quality review deck" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open task Renew passport" })).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Open task Write the weekly status update" }),
  ).toBeHidden();

  await page.getByRole("button", { name: "Overdue" }).press("Enter");
  await expect(
    page.getByRole("button", { name: "Open task Ship the search-quality review deck" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Clear all filters" }).press("Enter");
  await expect(page.getByLabel("Search tasks")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Open task Renew passport" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open task Write the weekly status update" }),
  ).toBeVisible();
});

test("labels the near-deadline state 'Near deadline' on the card, in the sheet, and in the filter (#73)", async ({
  page,
}) => {
  await signIn(page);

  await expect(card(page, "Renew passport")).toContainText("Near deadline");
  await expect(page.getByText("Due soon")).toHaveCount(0);

  const dialog = await openTaskSheet(page, "Renew passport");
  await expect(dialog.getByText("Near deadline")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const nearDeadline = page.getByRole("button", { name: "Near deadline" });
  await nearDeadline.click();
  await expect(nearDeadline).toHaveAttribute("aria-pressed", "true");

  await expect(card(page, "Renew passport")).toBeVisible();
  await expect(card(page, "Fix flaky checkout integration test")).toBeVisible();
  await expect(card(page, "Replace the kitchen tap washer")).toBeVisible();
  await expect(card(page, "Ship the search-quality review deck")).toBeHidden();

  const visibleCards = page.getByRole("button", { name: /^Open task / });
  for (const button of await visibleCards.all()) {
    await expect(button).toContainText("Near deadline");
  }
});
