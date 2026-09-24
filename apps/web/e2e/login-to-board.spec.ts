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

test("filters the board through its accessible controls", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("focusboard");
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.getByLabel("Search tasks").fill("RaFt");
  await expect(
    page.getByRole("button", { name: "Open task Read chapter 4 of the distributed systems book" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open task Renew passport" })).toBeHidden();
  await page.getByLabel("Search tasks").fill("");

  await choose(page, "Filter by category", "Personal");
  await expect(page.getByRole("button", { name: "Open task Renew passport" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open task Draft Q4 hiring plan" })).toBeHidden();
  await choose(page, "Filter by priority", "High");
  await expect(page.getByRole("button", { name: "Open task Renew passport" })).toBeVisible();
  await choose(page, "Filter by deadline", "Due within 24h");
  await expect(page.getByRole("button", { name: "Open task Renew passport" })).toBeVisible();
});

async function choose(page: import("@playwright/test").Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).press("Space");
  await page.getByRole("option", { name: option }).press("Enter");
}
