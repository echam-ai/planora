import { expect, test } from "@playwright/test";
import { openTaskSheet, signIn } from "./helpers";

/**
 * Scenario 8 supporting evidence through the real chat surface.
 *
 * The literal scenario — confirming the chat write *while* the sheet is open —
 * is unreachable in the UI: the task detail sheet is a modal, so its overlay
 * blocks the chat's Confirm button. The groomed fallback (component test with a
 * store-level update) covers that "while open" ordering deterministically in
 * `src/test/task-detail-sheet.test.tsx`. This flow proves the other half against
 * the running app: a confirmed chat write reaches the task, the sheet shows it,
 * and a later Save does not revert it. The write is still in flight (the mock
 * client delays every call) while the sheet opens, so it often lands with the
 * sheet open.
 *
 * The drawer at the app's mobile width is the chat surface exercised here. Below
 * 1024px the drawer is the only chat surface mounted (#62), so its inputs are
 * addressed from inside the drawer without any duplicate-id ambiguity.
 */
test.use({ viewport: { width: 390, height: 844 } });

const TASK = "Ship the search-quality review deck";
const RENAMED = "Ship the review deck (v2)";

test("scenario 8: a confirmed chat write is shown and not reverted by Save", async ({ page }) => {
  await signIn(page);

  await page.getByRole("banner").getByRole("button", { name: "AI Assistant", exact: true }).click();
  const chat = page.getByRole("dialog", { name: "AI Assistant" });
  await expect(chat).toBeVisible();
  await chat.locator("textarea").fill(`Set priority low for "${TASK}"`);
  await chat.locator("textarea").press("Enter");

  await expect(chat.getByRole("button", { name: "Confirm" })).toBeVisible();
  await chat.getByRole("button", { name: "Confirm" }).click();
  await chat.getByRole("button", { name: "Close assistant" }).click();
  await expect(chat).toBeHidden();

  const dialog = await openTaskSheet(page, TASK);
  const priority = dialog.getByRole("combobox", { name: "Priority" });
  await expect(priority).toHaveText(/Low/);

  await dialog.getByLabel("Title").fill(RENAMED);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  // Save carried only the title — the chat write survives
  const reopened = await openTaskSheet(page, RENAMED);
  await expect(reopened.getByRole("combobox", { name: "Priority" })).toHaveText(/Low/);
});
