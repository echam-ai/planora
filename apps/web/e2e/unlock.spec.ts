import { expect, test, type Page } from "@playwright/test";
import { DEMO_PASSWORD, unlock } from "./unlock";

// #124 against the mock adapter: the shared site password in front of the chooser.

const chooserHeading = (page: Page) => page.getByRole("heading", { name: "Choose your account" });
const passwordField = (page: Page) => page.getByLabel("Password");
const unlockButton = (page: Page) => page.getByRole("button", { name: "Unlock" });

async function lockFromMenu(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Lock" }).click();
}

test("a fresh visitor is sent to the password page, tries a wrong password, then unlocks", async ({
  page,
}) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page).toHaveTitle("Unlock — Planora");
  await expect(page.getByLabel("Selected account")).toHaveCount(0);
  await expect(page.getByText("focusboard")).toBeVisible();
  await expect(passwordField(page)).toBeFocused();
  await expect(passwordField(page)).toHaveAttribute("type", "password");
  await expect(passwordField(page)).toHaveAttribute("autocomplete", "current-password");

  await expect(unlockButton(page)).toBeEnabled();
  await passwordField(page).fill("nope");
  await passwordField(page).press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Incorrect password.");
  await expect(passwordField(page)).toBeFocused();
  await expect(page).toHaveURL(/\/login$/);

  await passwordField(page).fill(DEMO_PASSWORD);
  await passwordField(page).press("Enter");
  await expect(chooserHeading(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Hamster Knight", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ech Princess", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Hamster Knight", exact: true }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
});

test("every private route replaces its URL with /login while locked, and shows no private content", async ({
  page,
}) => {
  for (const path of ["/", "/tasks", "/archive", "/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(unlockButton(page)).toBeVisible();
    await expect(chooserHeading(page)).toHaveCount(0);
    await expect(page.getByLabel("Selected account")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Open task / })).toHaveCount(0);
  }
});

test("an unlock survives a reload, and /login then replaces itself with the chooser", async ({
  page,
}) => {
  await unlock(page);
  await page.reload();
  await expect(chooserHeading(page)).toBeVisible();
  await page.goto("/login");
  await expect(page).toHaveURL(/\/$/);
  await expect(chooserHeading(page)).toBeVisible();
});

test("an empty submission asks for the password and sends nothing", async ({ page }) => {
  await page.goto("/login");
  await expect(unlockButton(page)).toBeEnabled();
  await unlockButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("Enter the password.");
  await expect(passwordField(page)).toBeFocused();
  await expect(page).toHaveURL(/\/login$/);
});

for (const path of ["/tasks", "/archive", "/settings"]) {
  test(`Lock on ${path} is a keyboard-reachable menu item that returns to /login and Back shows no data`, async ({
    page,
  }) => {
    await unlock(page);
    await page.getByRole("button", { name: "Hamster Knight", exact: true }).click();
    await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
    await page.goto(path);
    const trigger = page.getByRole("button", { name: "Account menu" });
    await expect(trigger).toBeVisible();

    // Keyboard only: open the menu, move to Lock, activate it.
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Switch account" })).toBeVisible();
    const lock = menu.getByRole("menuitem", { name: "Lock" });
    await expect(lock).toBeVisible();
    // Keyboard opening puts focus on the menu's first item. End jumps to the last, which is
    // Lock; one ArrowUp reaches Switch account and one ArrowDown comes back.
    await expect(menu.getByRole("menuitemradio").first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(lock).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitem", { name: "Switch account" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(lock).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/login$/);
    await expect(unlockButton(page)).toBeVisible();
    await expect(page.getByLabel("Selected account")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Open (archived )?task / })).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: /^Open (archived )?task / })).toHaveCount(0);
    await expect(page.getByLabel("Selected account")).toHaveCount(0);
  });
}

test("Lock closes the assistant and any open task, and the mock refuses data until unlocked again", async ({
  page,
}) => {
  await unlock(page);
  await page.getByRole("button", { name: "Hamster Knight", exact: true }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "AI Assistant", exact: true }).click();
  await expect(page.getByLabel("Message the assistant")).toBeVisible();
  // On a phone the modal assistant drawer covers the account menu, so close it first.
  if ((page.viewportSize()?.width ?? 0) < 1024) await page.keyboard.press("Escape");
  await lockFromMenu(page);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Message the assistant")).toHaveCount(0);

  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login$/);
  await unlock(page);
  await page.getByRole("button", { name: "Hamster Knight", exact: true }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
});

test("an expired session mid-use returns to /login", async ({ page }) => {
  await unlock(page);
  await page.getByRole("button", { name: "Hamster Knight", exact: true }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  // The mock's cookie is its stored marker: removing it is the cookie expiring.
  await page.evaluate(() => window.localStorage.removeItem("planora.access"));
  await page.getByRole("link", { name: "Archive" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(unlockButton(page)).toBeVisible();
});

test("a failed Lock keeps the user on the page with an alert", async ({ page }) => {
  await unlock(page);
  await page.getByRole("button", { name: "Hamster Knight", exact: true }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  // The mock cannot fail to lock, so make the one place it writes refuse.
  await page.evaluate(() => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (key === "planora.access") throw new Error("storage refused");
      return remove.call(this, key);
    };
  });
  await lockFromMenu(page);
  await expect(page.getByRole("alert")).toHaveText("Couldn't lock. Try again.");
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
});
