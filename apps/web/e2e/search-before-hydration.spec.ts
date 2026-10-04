import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./helpers";
import { expectHydrated, holdScripts } from "./hydration";

// Before #124 these pages were server-rendered, so a search typed before hydration survived it
// (#113). Private pages now render only once the browser is known to be unlocked, which needs a
// script, so there is nothing to type into before hydration. The password page keeps the
// pre-hydration handling (`login-native-post.spec.ts`). What remains true, and is pinned here:
// a private page's server-rendered HTML shows no private content, and a search typed once the
// page has loaded is kept and applied.
const searches = [
  {
    path: "/archive",
    label: "Search archived tasks",
    selector: 'input[aria-label="Search archived tasks"]',
    early: "denti",
    rest: "st",
    match: "Open archived task Dentist appointment",
    other: "Open archived task Migrate the staging database to Postgres 16",
  },
  {
    path: "/tasks",
    label: "Search tasks",
    selector: 'input[aria-label="Search tasks"]',
    early: "pass",
    rest: "port",
    match: "Open task Renew passport",
    other: "Open task Draft Q4 hiring plan",
  },
] as const;

async function loadAndType(page: Page, search: (typeof searches)[number], text: string) {
  await signIn(page);
  await page.goto(search.path);
  await expectHydrated(page, search.selector);
  const input = page.getByRole("textbox", { name: search.label });
  await expect(input).toBeEditable();
  await input.pressSequentially(text);
  return input;
}

for (const search of searches) {
  test(`${search.path} server-renders no private content before scripts run`, async ({ page }) => {
    await signIn(page);
    const release = await holdScripts(page);
    await page.goto(search.path, { waitUntil: "commit" });
    await expect(page.locator("body")).toBeAttached();
    await expect(page.getByRole("textbox", { name: search.label })).toHaveCount(0);
    await expect(page.getByLabel("Selected account")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Open (archived )?task / })).toHaveCount(0);
    release();
    await expect(page.getByRole("textbox", { name: search.label })).toBeVisible();
  });

  test(`${search.path} keeps and applies a search typed once the page has loaded`, async ({
    page,
  }) => {
    const full = search.early + search.rest;
    const input = await loadAndType(page, search, full);

    await expect(page.getByRole("button", { name: search.match })).toBeVisible();
    await expect(input).toHaveValue(full);
    await expect(page.getByRole("button", { name: search.other })).toHaveCount(0);
  });

  test(`${search.path} continues typing after the first results`, async ({ page }) => {
    const input = await loadAndType(page, search, search.early);

    await expect(page.getByRole("button", { name: search.match })).toBeVisible();
    await expect(input).toHaveValue(search.early);
    await input.pressSequentially(search.rest);
    await expect(input).toHaveValue(search.early + search.rest);
    await expect(page.getByRole("button", { name: search.match })).toBeVisible();
    await expect(page.getByRole("button", { name: search.other })).toHaveCount(0);
  });
}
