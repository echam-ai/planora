import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Regression for #57.
 *
 * Below the `sm` breakpoint the header action buttons show only an icon —
 * their text lives in a `hidden sm:inline` span, which Tailwind renders with
 * `display: none` and therefore contributes nothing to the accessible name.
 * `Add task` already carries an `aria-label` (added for #19); this covers the
 * `AI Assistant` toggle at every breakpoint and pins the icons and the
 * mobile action group down with tests.
 */

const chatButton = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: "AI Assistant", exact: true });

test.describe("header action buttons", () => {
  test("scenario: the AI Assistant button starts unpressed with a stable name", async ({
    page,
  }) => {
    await signIn(page);
    await expect(chatButton(page)).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("header action buttons (desktop docked panel)", () => {
  test("scenario: the AI Assistant button's name stays the same, with no doubling, while aria-pressed toggles", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "the docked side panel (>=1024px) keeps the header visible to assistive tech while open; " +
        "the mobile drawer correctly hides the rest of the page behind its modal, which #81 owns",
    );
    await signIn(page);

    // The visible text span is shown here too (>=640px); a doubled name such
    // as "AI Assistant AI Assistant" would make this exact-name locator match
    // nothing.
    const button = chatButton(page);
    await expect(button).toHaveAttribute("aria-pressed", "false");

    await button.click();
    await expect(chatButton(page)).toHaveAttribute("aria-pressed", "true");

    await button.click();
    await expect(chatButton(page)).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("header action buttons (mobile-chromium)", () => {
  test("scenario: a screen-reader user on a phone finds the header actions", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chromium",
      "asserts the <640px header layout where only icons are visible",
    );
    await signIn(page);

    const actions = page.locator("header div.ml-auto");
    await expect(actions).toMatchAriaSnapshot(`
      - button "Add task"
      - button "AI Assistant" [pressed=false]
      - link "Settings"
      - button "Account menu"
    `);

    // The visible text mirroring the label is present for `sm` and up only.
    await expect(page.getByText("AI Assistant", { exact: true })).toBeHidden();
  });

  test("scenario: aria-pressed round-trips through opening and closing the mobile drawer", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chromium",
      "asserts the <1024px drawer's aria-hidden side effect on the header",
    );
    await signIn(page);

    await expect(chatButton(page)).toHaveAttribute("aria-pressed", "false");

    await chatButton(page).click();

    // The mobile drawer's Radix dialog aria-hides the rest of the page,
    // including the header, while it is open — correct, deliberate modal
    // behavior (the drawer itself is #81's territory, not this issue's). A
    // role query for the button then finds nothing...
    await expect(chatButton(page)).toHaveCount(0);
    // ...but the underlying `aria-pressed` DOM attribute is still directly
    // readable, regardless of `aria-hidden`, and correctly reports the open
    // state.
    await expect(page.locator("header button[aria-pressed]")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await page.keyboard.press("Escape");

    // Closing removes the aria-hidden side effect: the same role-and-name
    // locator resolves again, with the name unchanged and the state reset.
    await expect(chatButton(page)).toHaveAttribute("aria-pressed", "false");
  });
});
