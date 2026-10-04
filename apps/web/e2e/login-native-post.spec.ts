import { expect, test } from "@playwright/test";
import { holdScripts } from "./hydration";
import { DEMO_PASSWORD, unlock } from "./unlock";

const PASSWORD = "typed-before-hydration-124";

test("a native POST /login redirects back to the password page and sets no cookie", async ({
  page,
  context,
}) => {
  const response = await page.request.post("/login", {
    form: { password: PASSWORD },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers()["location"]).toBe("/login");
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  expect(await response.text()).toBe("");
  expect(await context.cookies()).toEqual([]);
});

test("submitting the form before hydration leaves the browser at exactly /login, without the password", async ({
  page,
  context,
}) => {
  const release = await holdScripts(page);
  await page.goto("/login", { waitUntil: "commit" });
  const form = page.locator("form[method='post'][action='/login']");
  await expect(form).toBeVisible();
  // React has not run: the button is still disabled, so Enter cannot submit either.
  await expect(page.getByRole("button", { name: "Unlock" })).toBeDisabled();
  await page.getByLabel("Password").fill(PASSWORD);

  const navigated = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/login" && r.request().method() === "POST",
  );
  await form.evaluate((element) => (element as HTMLFormElement).requestSubmit());
  expect((await navigated).status()).toBe(303);

  await expect(page).toHaveURL(/\/login$/);
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.search).toBe("");
  expect(page.url()).not.toContain(PASSWORD);
  expect(await context.cookies()).toEqual([]);

  // The page that came back works once its scripts run.
  release();
  await expect(page.getByRole("button", { name: "Unlock" })).toBeEnabled();
  await expect(page.getByLabel("Password")).toHaveValue("");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("heading", { name: "Choose your account" })).toBeVisible();
});

test("a password typed before hydration is kept and unlocks once the page is interactive", async ({
  page,
}) => {
  const release = await holdScripts(page);
  await page.goto("/login", { waitUntil: "commit" });
  await expect(page.getByLabel("Password")).toBeEditable();
  await page.getByLabel("Password").pressSequentially(DEMO_PASSWORD);
  release();
  await expect(page.getByRole("button", { name: "Unlock" })).toBeEnabled();
  await expect(page.getByLabel("Password")).toHaveValue(DEMO_PASSWORD);
  await page.getByLabel("Password").press("Enter");
  await expect(page.getByRole("heading", { name: "Choose your account" })).toBeVisible();
});

test("an unlocked browser that opens /login goes straight to the chooser", async ({ page }) => {
  await unlock(page);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Choose your account" })).toBeVisible();
});
