import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * #91: a failed send persists nothing (as the API does), so the panel hands the
 * typed text back and shows the notice instead of losing the message.
 */
test("a failed send keeps the typed text and shows the notice", async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => window.localStorage.setItem("planora.forceError", "true"));
  await page.getByRole("banner").getByRole("button", { name: "AI Assistant", exact: true }).click();
  // Docked panel on desktop, drawer dialog on mobile: only one is mounted at a time.
  const input = page.getByLabel("Message the assistant");

  await input.fill("What is overdue?");
  await input.press("Enter");

  await expect(page.getByText("The assistant didn't respond.")).toBeVisible({ timeout: 15_000 });
  await expect(input).toHaveValue("What is overdue?");
  // Nothing was saved, so the conversation is still empty.
  await expect(page.getByText(/I never change anything without your confirmation/)).toBeVisible();
});
