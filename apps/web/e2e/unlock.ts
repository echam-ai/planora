import { expect, type Page } from "@playwright/test";

/** The mock adapter's fixed demo password (`services/api/mock/access.ts`). */
export const DEMO_PASSWORD = "focusboard";

/**
 * Unlocks through the real password page and ends on the account chooser. Shared by the mock
 * and HTTP suites, so every spec gets past the gate the way a visitor does (#124). The mock
 * keeps the unlock in the browser's storage and the API keeps it in an HttpOnly cookie, so the
 * rest of a spec's navigation stays unlocked either way.
 *
 * The Unlock button is disabled until React has hydrated, which also blocks Enter, so waiting
 * for it to be enabled is the hydration wait.
 */
export async function unlock(page: Page, password: string = DEMO_PASSWORD) {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Unlock" })).toBeEnabled();
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Password").press("Enter");
  await expect(page.getByRole("heading", { name: "Choose your account" })).toBeVisible();
}
