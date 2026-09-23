import { expect, test } from "@playwright/test";
import {
  column,
  dragCardToColumn,
  openTaskSheet,
  readCompletedAt,
  signIn,
  statusControl,
} from "./helpers";

const DRAGGED = "Ship the search-quality review deck";
const RENAMED = "Ship the review deck (v2)";

test("scenario 5: drag, open the sheet, edit, save — the drag is not undone", async ({ page }) => {
  await signIn(page);

  await dragCardToColumn(page, DRAGGED, "In progress");

  const dialog = await openTaskSheet(page, DRAGGED);
  await expect(statusControl(page)).toHaveText(/In Progress/);

  await dialog.getByLabel("Title").fill(RENAMED);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  await expect(
    column(page, "In progress").getByRole("button", { name: `Open task ${RENAMED}`, exact: true }),
  ).toBeVisible();
  await expect(
    column(page, "To do").getByRole("button", { name: `Open task ${RENAMED}`, exact: true }),
  ).toHaveCount(0);
});

test("scenario 6: a Done task with a past deadline stays Done and completed (spec 17.24)", async ({
  page,
}) => {
  const DONE_TASK = "Write the weekly status update";
  await signIn(page);

  let dialog = await openTaskSheet(page, DONE_TASK);
  await expect(statusControl(page)).toHaveText(/Done/);
  const completedBefore = await readCompletedAt(page, DONE_TASK);
  expect(completedBefore).toBeTruthy();

  await dialog.getByLabel("Content").fill("Edited content for the weekly update");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  // the card renders the Completed state, not a timing-based deadline state
  const doneCard = column(page, "Done").getByRole("button", {
    name: `Open task ${DONE_TASK}`,
    exact: true,
  });
  await expect(doneCard).toBeVisible();
  await expect(doneCard).toContainText("Completed");

  dialog = await openTaskSheet(page, DONE_TASK);
  await expect(statusControl(page)).toHaveText(/Done/);
  await expect(dialog.getByLabel("Content")).toHaveValue("Edited content for the weekly update");
  await expect(dialog.locator('dt:has-text("Completed") + dd')).not.toHaveText("—");
  expect(await readCompletedAt(page, DONE_TASK)).toBe(completedBefore);
});
