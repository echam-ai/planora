import { expect, test, type Page } from "@playwright/test";

import { unlock } from "../e2e/unlock";
import { SITE_PASSWORD } from "./env";

/**
 * #124 against the real API: the shared site password in front of the chooser. Every spec
 * shares the client IP 127.0.0.1 with the rest of the suite, and the API blocks an IP after five
 * wrong passwords in 15 minutes (a success resets the count), so each test types at most one.
 */
const PROFILE = { "X-Planora-Profile": "hamster_knight" };

const passwordField = (page: Page) => page.getByLabel("Password");
const chooserHeading = (page: Page) => page.getByRole("heading", { name: "Choose your account" });

test("a fresh visitor reaches the password page, is refused once, then unlocks and works", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  // An HTTP build never carries the mock's demo password.
  await expect(page.getByText("focusboard")).toHaveCount(0);
  await expect(page.getByText(/demo password/i)).toHaveCount(0);

  await expect(page.getByRole("button", { name: "Unlock" })).toBeEnabled();
  await passwordField(page).fill("definitely-not-the-password");
  await passwordField(page).press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Incorrect password.");
  await expect(passwordField(page)).toBeFocused();
  expect(await context.cookies()).toEqual([]);

  await passwordField(page).fill(SITE_PASSWORD);
  await passwordField(page).press("Enter");
  await expect(chooserHeading(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Hamster Knight", exact: true })).toBeVisible();

  // The cookie is the API's: HttpOnly (the page cannot read it), Lax, site-wide.
  const cookies = await context.cookies();
  expect(cookies).toHaveLength(1);
  expect(cookies[0]).toMatchObject({
    name: "planora_access",
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });
  expect(await page.evaluate(() => document.cookie)).toBe("");

  await page.getByRole("button", { name: "Hamster Knight", exact: true }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  const title = `Unlock flow ${Date.now()}`;
  await page.getByRole("button", { name: "Add task" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await dialog.getByRole("tab", { name: "Task form" }).click();
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Content").fill("Created after unlocking.");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: `Open task ${title}`, exact: true })).toBeVisible();
});

test("Lock returns to /login and the API then refuses data without the cookie", async ({
  page,
}) => {
  await unlock(page, SITE_PASSWORD);
  await page.getByRole("button", { name: "Hamster Knight", exact: true }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  expect((await page.request.get("/api/v1/tasks", { headers: PROFILE })).status()).toBe(200);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Lock" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open task / })).toHaveCount(0);

  const refused = await page.request.get("/api/v1/tasks", { headers: PROFILE });
  expect(refused.status()).toBe(401);
  expect(await refused.json()).toMatchObject({ code: "NOT_AUTHENTICATED" });
  expect((await page.context().cookies()).filter((c) => c.name === "planora_access")).toEqual([]);

  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: /^Open task / })).toHaveCount(0);
});

test("a session that expires mid-use lands on /login", async ({ page, context }) => {
  await unlock(page, SITE_PASSWORD);
  await page.getByRole("button", { name: "Hamster Knight", exact: true }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();

  // The browser loses the cookie (expiry, another tab locking); the next request finds out.
  await context.clearCookies();
  await page.getByRole("link", { name: "Archive" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open (archived )?task / })).toHaveCount(0);
});

test("an unlock survives a reload and keeps /login out of reach", async ({ page }) => {
  await unlock(page, SITE_PASSWORD);
  await page.reload();
  await expect(chooserHeading(page)).toBeVisible();
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
  await expect(chooserHeading(page)).toBeVisible();
});
