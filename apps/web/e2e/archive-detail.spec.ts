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
  const archivedCard = page.getByRole("button", { name: `Open archived task ${ARCHIVED}` });
  await expect(archivedCard).toHaveAccessibleName(`Open archived task ${ARCHIVED}`);
  await expect(archivedCard).toHaveAccessibleDescription(/Completed/);
  await expect(archivedCard).not.toHaveAccessibleDescription(/Overdue/);
  await archivedCard.click();
  const dialog = page.getByRole("dialog", { name: ARCHIVED });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Archived task (read only)");
  await expect(dialog.getByLabel("Title")).toHaveCount(0);

  // #68: the read-only view's deadline badge names itself only through
  // rendered text — no "Deadline state:" accessible name.
  await expect(dialog.locator('span:text-is("Completed")')).toMatchAriaSnapshot(
    `- text: Completed`,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: `Delete ${ARCHIVED} permanently` }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(ARCHIVED);
  await confirm.getByRole("button", { name: "Keep task" }).click();
  await expect(confirm).toBeHidden();

  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("button", { name: `Open archived task ${ARCHIVED}` })).toHaveCount(0);
});

test("archived details delete permanently and remain absent from search after refresh", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/archive");
  await page.getByLabel("Search archived tasks").fill("postgres");
  const card = page.getByRole("button", { name: `Open archived task ${ARCHIVED}` });
  await card.click();
  await page
    .getByRole("dialog", { name: ARCHIVED })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(ARCHIVED);
  await expect(confirm).toContainText("cannot be undone");
  await confirm.getByRole("button", { name: "Delete task" }).press("Enter");
  await expect(confirm).toBeHidden();
  await expect(card).toHaveCount(0);
  await page.reload();
  await page.getByLabel("Search archived tasks").fill("postgres");
  await expect(card).toHaveCount(0);
});
