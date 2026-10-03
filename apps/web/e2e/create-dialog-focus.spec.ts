import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/** Issue #121: the create dialog opens on the first click after a fresh load,
 * returns focus to "Add task" when it closes, and resets on reopen. */
test("scenario: opens the create dialog on the first click and returns focus on Escape", async ({
  page,
}) => {
  await signIn(page);
  const add = page.getByRole("button", { name: "Add task" });

  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Quick capture" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.locator(":focus")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
});

test("scenario: reopening after Cancel shows an empty Quick capture tab", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await dialog.getByRole("tab", { name: "Task form" }).click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Add task" }).click();
  await expect(dialog.getByRole("tab", { name: "Quick capture" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(dialog.getByRole("textbox").first()).toHaveValue("");
});
