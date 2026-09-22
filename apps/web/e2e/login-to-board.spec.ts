import { expect, test } from "@playwright/test";

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
