import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Issue #19: deadline entry interprets the wall-clock time in the Settings
 * timezone, never the browser's — and changing Settings later changes only
 * display, never the stored instant (§6.1, §11).
 */
test.use({ timezoneId: "America/Los_Angeles" });

test("scenario: deadline entry is independent of the browser timezone and follows Settings on display", async ({
  page,
}) => {
  await signIn(page); // Settings default to Asia/Singapore, browser is America/Los_Angeles

  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await dialog.getByRole("tab", { name: "Task form" }).click();

  await dialog.getByLabel("Title").fill("Ship the deadline check");
  await dialog.getByLabel("Content").fill("Verify timezone-independent deadline entry.");
  await expect(dialog.getByText("Interpreted in Asia/Singapore")).toBeVisible();

  // Open the calendar and accept the auto-focused day (today) — the exact
  // date does not matter, only that entry and display agree on the instant.
  await dialog.getByLabel("Date").click();
  await page.keyboard.press("Enter");
  await dialog.getByLabel("Time").fill("17:00");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();

  const card = page.getByRole("button", { name: "Open task Ship the deadline check" });
  await expect(card).toContainText("17:00");

  // Switch Settings to UTC: the stored instant is unchanged, only the
  // displayed wall-clock time shifts (09:00 = 17:00 Asia/Singapore in UTC).
  await page.getByRole("link", { name: "Settings" }).first().click();
  await page.getByRole("combobox", { name: "Timezone" }).click();
  await page.getByRole("option", { name: "UTC", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  await page.getByRole("link", { name: "Active Tasks" }).first().click();
  await expect(card).toContainText("09:00");
  await expect(card).not.toContainText("17:00");
});
