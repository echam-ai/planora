import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const ARCHIVED = "Migrate the staging database to Postgres 16";

test("archive detail is read-only and archive actions retain their confirmation flow", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Archive" }).click();
  await expect(page.getByRole("heading", { name: "Archive" })).toBeVisible();

  await page.getByLabel("Search archived tasks").fill("postgres");
  await page.getByRole("button", { name: `Open archived task ${ARCHIVED}` }).click();
  const dialog = page.getByRole("dialog", { name: ARCHIVED });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Archived task (read only)");
  await expect(dialog.getByLabel("Title")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: `Delete ${ARCHIVED} permanently` }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(ARCHIVED);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("button", { name: `Open archived task ${ARCHIVED}` })).toHaveCount(0);
});
