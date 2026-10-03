import { expect, test } from "@playwright/test";
import { card, openTaskSheet, signIn } from "./helpers";

test("signs in and shows the three board columns", async ({ page }) => {
  await signIn(page);

  await expect(page.getByRole("link", { name: "Active Tasks" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "In progress" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
});

test("combines multi-select board filters and clears them by keyboard", async ({ page }) => {
  await signIn(page);
  const search = page.getByLabel("Search tasks");
  await search.fill("RaFt");
  await expect(card(page, "Read chapter 4 of the distributed systems book")).toBeVisible();
  await expect(card(page, "Renew passport")).toBeHidden();
  await search.fill("");

  await page.getByRole("button", { name: "Category", exact: true }).press("Enter");
  const work = page.getByRole("button", { name: "Work", exact: true });
  const personal = page.getByRole("button", { name: "Personal", exact: true });
  await expect(work).toBeFocused();
  await work.press("Space");
  await personal.press("Enter");
  for (const option of [work, personal]) {
    await expect(option).toHaveAttribute("aria-pressed", "true");
    await expect(option.locator("svg")).toBeVisible();
  }
  await expect(page.getByRole("dialog", { name: "Category filters" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Category 2", exact: true }),
  ).toHaveAccessibleDescription("Selected: Work, Personal");
  await page.getByRole("button", { name: "Priority", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Category filters" })).toHaveCount(0);
  await page.getByRole("button", { name: "High", exact: true }).click();
  await page.getByRole("button", { name: "Low", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Priority 2", exact: true }),
  ).toHaveAccessibleDescription("Selected: Low, High");
  await page.getByRole("button", { name: "Deadline", exact: true }).click();
  await page.getByRole("button", { name: "Scheduled", exact: true }).click();
  await page.getByRole("button", { name: "Overdue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Deadline 2", exact: true }),
  ).toHaveAccessibleDescription("Selected: Scheduled, Overdue");
  await expect(card(page, "Ship the search-quality review deck")).toBeVisible();
  await expect(card(page, "Renew passport")).toBeHidden();
  await expect(card(page, "Write the weekly status update")).toBeHidden();
  await page.getByRole("button", { name: "Overdue", exact: true }).press("Enter");
  await expect(
    page.getByRole("button", { name: "Deadline 1", exact: true }),
  ).toHaveAccessibleDescription("Selected: Scheduled");
  await expect(card(page, "Ship the search-quality review deck")).toBeHidden();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Clear all filters" }).press("Enter");
  await expect(search).toHaveValue("");
  await expect(card(page, "Renew passport")).toBeVisible();
  await expect(card(page, "Write the weekly status update")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear all filters" })).toHaveCount(0);

  await search.fill("No matching task for reset");
  for (const [dimension, option] of [
    ["Category", "Work"],
    ["Priority", "High"],
    ["Deadline", "No deadline"],
  ] as const) {
    await page.getByRole("button", { name: dimension, exact: true }).click();
    await page.getByRole("button", { name: option, exact: true }).click();
  }
  await expect(page.getByRole("button", { name: /^Open task / })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Clear all filters" }).click();
  await expect(search).toHaveValue("");
  for (const dimension of ["Category", "Priority", "Deadline"]) {
    await expect(
      page.getByRole("button", { name: dimension, exact: true }),
    ).toHaveAccessibleDescription("No selections");
  }
  await expect(page.getByRole("button", { name: "Clear all filters" })).toHaveCount(0);
  await expect(card(page, "Renew passport")).toBeVisible();
});

test("keyboard opens filters, toggles without dismissal, returns focus and tabs out", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("textbox", { name: "Search tasks" }).focus();
  await page.keyboard.press("Tab");
  for (const [dimension, options] of [
    ["Category", ["Work", "Personal", "Study", "Other"]],
    ["Priority", ["Low", "Medium", "High"]],
    ["Deadline", ["No deadline", "Scheduled", "Near deadline", "Overdue"]],
  ] as const) {
    const trigger = page.getByRole("button", { name: new RegExp(`^${dimension}( [0-9]+)?$`) });
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `${dimension} filters` });
    for (const [index, name] of options.entries()) {
      const option = dialog.getByRole("button", { name, exact: true });
      await expect(option).toBeFocused();
      expect(
        await option.evaluate(
          (element) =>
            element.matches(":focus-visible") && getComputedStyle(element).boxShadow !== "none",
        ),
      ).toBe(true);
      if (index === 0) {
        await page.keyboard.press("Space");
        await expect(option).toHaveAttribute("aria-pressed", "true");
        await expect(option.locator("svg")).toBeVisible();
        await page.keyboard.press("Enter");
        await expect(option).toHaveAttribute("aria-pressed", "false");
        await expect(option.locator("svg")).toHaveCount(0);
        await page.keyboard.press("Space");
      }
      await page.keyboard.press("Tab");
    }
    const close = dialog.getByRole("button", { name: `Close ${dimension} filters` });
    await expect(close).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Space");
    await expect(dialog.getByRole("button", { name: options[0], exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    for (let step = 0; step < options.length; step++) await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: "Clear all filters" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Clear all filters" })).toHaveCount(0);
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

  await page.getByRole("button", { name: "Deadline", exact: true }).click();
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
