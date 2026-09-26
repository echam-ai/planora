import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/** Issue #19: the deadline control is a date picker plus a time field, both
 * reachable and settable by keyboard alone (§12.3 item 2). */
test("scenario: sets a deadline by keyboard only", async ({ page }) => {
  await signIn(page);

  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await dialog.getByRole("tab", { name: "Task form" }).click();

  await dialog.getByLabel("Title").fill("Ship the launch checklist");
  await dialog.getByLabel("Content").fill("Walk through the launch steps.");

  const dateField = dialog.getByLabel("Date");
  await dateField.focus();
  await expect(dateField).toBeFocused();
  await page.keyboard.press("Enter");
  // The calendar opens focused on today; arrow keys move the focused day and
  // Enter selects it — no mouse involved.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(dateField).not.toHaveText("Pick a date");
  const chosenDate = (await dateField.textContent())?.trim();

  await page.keyboard.press("Tab");
  const timeField = dialog.getByLabel("Time");
  await expect(timeField).toBeFocused();
  await page.keyboard.type("0500PM");
  await expect(timeField).toHaveValue("17:00");

  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();

  const card = page.getByRole("button", { name: "Open task Ship the launch checklist" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("17:00");

  await card.click();
  const detail = page.getByRole("dialog", { name: "Ship the launch checklist" });
  await expect(detail.getByLabel("Date")).toHaveText(chosenDate ?? "");
  await expect(detail.getByLabel("Time")).toHaveValue("17:00");
});

/** Issue #19 rework: a visible "Clear deadline" control, reachable and
 * operable by keyboard, empties both fields at once. */
test("scenario: clears a deadline by keyboard using the Clear deadline button", async ({
  page,
}) => {
  await signIn(page);

  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await dialog.getByRole("tab", { name: "Task form" }).click();

  await dialog.getByLabel("Title").fill("Draft the retro notes");
  await dialog.getByLabel("Content").fill("Summarise what went well and what didn't.");

  await expect(dialog.getByRole("button", { name: "Clear deadline" })).not.toBeVisible();

  const dateField = dialog.getByLabel("Date");
  await dateField.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter"); // accept the auto-focused day (today)
  await page.keyboard.press("Tab");
  const timeField = dialog.getByLabel("Time");
  await page.keyboard.type("0500PM");
  await expect(timeField).toHaveValue("17:00");

  const clearButton = dialog.getByRole("button", { name: "Clear deadline" });
  await expect(clearButton).toBeVisible();
  // A native time input has separate hour/minute/period segments; Tab must
  // leave the last one before focus reaches the next control.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(clearButton).toBeFocused();
  await page.keyboard.press("Enter");

  // Clearing unmounts the button the user just pressed; focus must land on
  // the date trigger, not fall back to the dialog container.
  await expect(dateField).toBeFocused();
  await expect(dateField).toHaveText("Pick a date");
  await expect(timeField).toHaveValue("");
  await expect(clearButton).not.toBeVisible();

  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();

  const card = page.getByRole("button", { name: "Open task Draft the retro notes" });
  await expect(card).toContainText("No deadline");
});
