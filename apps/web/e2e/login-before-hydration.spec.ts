import { expect, test } from "@playwright/test";

import { signIn } from "./helpers";
import { expectHydrated, holdScripts } from "./hydration";

// #112: a page loaded directly is server-rendered, so its inputs are usable
// before the client bundle hydrates. Text typed (or autofilled) in that
// window must survive hydration, and a pre-hydration submit must never put
// the password in the URL. Hydration is held deterministically by parking
// every script request on a gate the test opens itself; no timing involved.

const USERNAME = "demo";
const PASSWORD = "focusboard";

test.describe("forms typed into before hydration", () => {
  test("login keeps typed credentials and signs in", async ({ page }) => {
    const release = await holdScripts(page);
    await page.goto("/login", { waitUntil: "commit" });
    await expect(page.getByLabel("Username")).toBeVisible();

    await page.getByLabel("Username").pressSequentially(USERNAME);
    await page.getByLabel("Password").pressSequentially(PASSWORD);
    release();
    await expectHydrated(page, "#username");

    await expect(page.getByLabel("Username")).toHaveValue(USERNAME);
    await expect(page.getByLabel("Password")).toHaveValue(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
    await expect(page.getByText("Enter your username")).toHaveCount(0);
    await expect(page.getByText("Enter your password")).toHaveCount(0);
  });

  test("an early Enter never puts the password in the URL", async ({ page }) => {
    const urls: string[] = [];
    page.on("request", (request) => urls.push(request.url()));
    const release = await holdScripts(page);
    await page.goto("/login", { waitUntil: "commit" });
    await expect(page.getByLabel("Username")).toBeVisible();

    await page.getByLabel("Username").pressSequentially(USERNAME);
    await page.getByLabel("Password").pressSequentially(PASSWORD);
    // Nothing can handle a submit yet, so the button is held disabled, which
    // also stops the browser's implicit (Enter) submission.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled();
    await page.getByLabel("Password").press("Enter");
    // The real key press has completed; observe that the disabled form kept us
    // on the login page while scripts are still held, then allow hydration.
    await expect(page).toHaveURL(/\/login$/);
    release();
    await expectHydrated(page, "#username");

    expect(urls.filter((u) => u.includes("password=") || u.includes(PASSWORD))).toEqual([]);
    expect(new URL(page.url()).search).toBe("");
    await expect(page.getByLabel("Username")).toHaveValue(USERNAME);
    await expect(page.getByLabel("Password")).toHaveValue(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  });

  test("change-password fields keep text typed before hydration", async ({ page }) => {
    await signIn(page);
    const release = await holdScripts(page);
    await page.goto("/settings", { waitUntil: "commit" });
    await expect(page.getByLabel("Current password")).toBeVisible();

    await page.getByLabel("Current password").pressSequentially("old-secret");
    await page.getByLabel("New password").pressSequentially("new-secret");
    release();
    await expectHydrated(page, "#cur");
    // The settings query resolves after hydration and re-renders the page; the
    // typed text must survive that re-render, so wait for it before asserting.
    await expect(page.getByRole("combobox", { name: "Timezone" })).toBeVisible();

    await expect(page.getByLabel("Current password")).toHaveValue("old-secret");
    await expect(page.getByLabel("New password")).toHaveValue("new-secret");
  });
});
