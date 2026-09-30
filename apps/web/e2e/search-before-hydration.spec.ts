import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./helpers";
import { expectHydrated, holdScripts } from "./hydration";

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

async function loadWithEarlySearch(page: Page, search: (typeof searches)[number], text: string) {
  await signIn(page);
  const release = await holdScripts(page);
  await page.goto(search.path, { waitUntil: "commit" });
  const input = page.getByRole("textbox", { name: search.label });
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  await input.pressSequentially(text);
  release();
  await expectHydrated(page, search.selector);
  return input;
}

for (const search of searches) {
  test(`${search.path} keeps and applies a search typed before hydration`, async ({ page }) => {
    const full = search.early + search.rest;
    const input = await loadWithEarlySearch(page, search, full);

    // The data query re-renders the controlled input after hydration.
    await expect(page.getByRole("button", { name: search.match })).toBeVisible();
    await expect(input).toHaveValue(full);
    await expect(page.getByRole("button", { name: search.other })).toHaveCount(0);
  });

  test(`${search.path} continues typing after hydration`, async ({ page }) => {
    const input = await loadWithEarlySearch(page, search, search.early);

    await expect(page.getByRole("button", { name: search.match })).toBeVisible();
    await expect(input).toHaveValue(search.early);
    await input.pressSequentially(search.rest);
    await expect(input).toHaveValue(search.early + search.rest);
    await expect(page.getByRole("button", { name: search.match })).toBeVisible();
    await expect(page.getByRole("button", { name: search.other })).toHaveCount(0);
  });
}
