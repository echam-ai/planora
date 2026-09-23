import { expect, test } from "@playwright/test";
import { column, dragCardToColumn, openTaskSheet, signIn, statusControl } from "./helpers";

// Spec 17.15: the same behaviour at a 390×844 emulated mobile viewport.
test.use({ viewport: { width: 390, height: 844 } });

const DRAGGED = "Draft Q4 hiring plan";
const RENAMED = "Draft the Q4 hiring plan (v2)";

test("scenario 7: the board reproduction at 390×844", async ({ page }) => {
  await signIn(page);

  await dragCardToColumn(page, DRAGGED, "In progress");

  const dialog = await openTaskSheet(page, DRAGGED);
  await expect(statusControl(page)).toHaveText(/In Progress/);

  await dialog.getByLabel("Title").fill(RENAMED);
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  // Save must not revert the status the drag wrote
  await expect(
    column(page, "In progress").getByRole("button", { name: `Open task ${RENAMED}`, exact: true }),
  ).toBeVisible();
  const reopened = await openTaskSheet(page, RENAMED);
  await expect(reopened.getByRole("combobox", { name: "Status" })).toHaveText(/In Progress/);
});
