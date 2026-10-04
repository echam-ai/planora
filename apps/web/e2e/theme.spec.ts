import { expect, test, type ConsoleMessage } from "@playwright/test";
import { signIn } from "./helpers";
import { expectHydrated, holdScripts } from "./hydration";
import { expectTheme, seedTheme, storedTheme, themeBackground } from "./theme";

const themeGroup = (page: import("@playwright/test").Page) =>
  page.getByRole("radiogroup", { name: "Theme" });

test.describe("theme preference (#122)", () => {
  test("picking a theme in Settings applies at once, persists, and survives a reload", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signIn(page);
    await page.goto("/settings");
    // Controls only act once React has attached its handlers.
    await expectHydrated(page, "main");
    const group = themeGroup(page);
    await expect(group.getByRole("radio")).toHaveCount(4);
    await expect(group.getByRole("radio", { name: "System" })).toBeChecked();
    await expect(page.getByText("Applies to this browser, for both accounts.")).toBeVisible();

    // No API call and no Save changes: the choice lands the moment it is made.
    const apiCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/")) apiCalls.push(request.url());
    });
    await group.getByRole("radio", { name: "Dark" }).check();
    await expectTheme(page, "dark");
    expect(await storedTheme(page)).toBe("dark");
    expect(apiCalls).toEqual([]);

    await page.reload();
    await expectHydrated(page, "main");
    await expect(themeGroup(page).getByRole("radio", { name: "Dark" })).toBeChecked();
    await expectTheme(page, "dark");
  });

  test("the Account menu lists the same four themes and applies a choice", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await seedTheme(page, "light");
    await signIn(page);
    await expectHydrated(page, "main");
    await expectTheme(page, "light");

    await page.getByRole("button", { name: "Account menu" }).click();
    const items = page.getByRole("menuitemradio");
    await expect(items).toHaveText(["System", "Light", "Dark", "Colorful"]);
    await expect(page.getByRole("menuitemradio", { name: "Light" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await page.getByRole("menuitemradio", { name: "Colorful" }).click();
    await expectTheme(page, "colorful");

    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Colorful" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByRole("menuitem", { name: "Switch account" })).toBeVisible();
  });

  test("the theme survives Switch account, on the chooser and on the other profile", async ({
    page,
  }) => {
    await seedTheme(page, "colorful");
    await signIn(page);
    await expectTheme(page, "colorful");

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Switch account" }).click();
    await expect(page.getByRole("heading", { name: "Choose your account" })).toBeVisible();
    await expectTheme(page, "colorful");

    await page.getByRole("button", { name: "Ech Princess", exact: true }).click();
    await expect(page.getByLabel("Selected account")).toHaveText("Ech Princess");
    await expectTheme(page, "colorful");
    expect(await storedTheme(page)).toBe("colorful");
  });

  test("System follows the operating system live, and an invalid stored value means System", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await signIn(page);
    await page.goto("/settings");
    await expectHydrated(page, "main");
    await expectTheme(page, "light");
    await expect(themeGroup(page).getByRole("radio", { name: "System" })).toBeChecked();

    await page.emulateMedia({ colorScheme: "dark" });
    await expectTheme(page, "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expectTheme(page, "light");
  });

  test("an invalid stored value is shown as System", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await seedTheme(page, "neon");
    await signIn(page);
    await page.goto("/settings");
    await expect(themeGroup(page).getByRole("radio", { name: "System" })).toBeChecked();
    await expectTheme(page, "dark");
  });

  test("keyboard: arrow keys change the Settings theme, and the Account menu works with Enter", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "hardware keyboard navigation; the mobile project drives touch",
    );
    await page.emulateMedia({ colorScheme: "light" });
    await signIn(page);
    await page.goto("/settings");
    await expectHydrated(page, "main");

    const heading = page.getByRole("heading", { name: "Appearance" });
    await heading.evaluate((el) => {
      el.setAttribute("tabindex", "-1");
      el.focus();
    });
    await page.keyboard.press("Tab");
    await expect(page.getByRole("radio", { name: "System" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
    await expectTheme(page, "dark");

    await page.getByRole("button", { name: "Account menu" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "System" })).toBeFocused();
    for (const name of ["Light", "Dark", "Colorful"]) {
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("menuitemradio", { name })).toBeFocused();
    }
    await page.keyboard.press("Enter");
    await expectTheme(page, "colorful");
    expect(await storedTheme(page)).toBe("colorful");
  });

  test("no flash of the wrong theme: <html> and <body> are themed before any script runs", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() => {
      window.localStorage.setItem("planora.profile", "hamster_knight");
      // Already unlocked: this test is about the theme before any script runs, not the gate.
      window.localStorage.setItem("planora.access", "1");
      window.localStorage.setItem("planora.theme", "dark");
    });
    const messages: ConsoleMessage[] = [];
    page.on("console", (message) => messages.push(message));

    const release = await holdScripts(page);
    await page.goto("/tasks", { waitUntil: "commit" });

    // Every script request is parked, so only the inline head script can have run.
    await expectTheme(page, "dark");
    const expectedDark = await themeBackground(page, "dark");
    expect(expectedDark).not.toBe(await themeBackground(page, "light"));
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe(expectedDark);

    release();
    await expectHydrated(page, "main");
    await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
    await expectTheme(page, "dark");
    const hydrationProblems = messages
      .filter((message) => ["error", "warning"].includes(message.type()))
      .map((message) => message.text())
      // The dev server echoes every other page's logs back as "[Server] ..."; only this
      // page's own messages count.
      .filter((text) => !text.includes("[Server]"))
      .filter((text) => /hydrat|did not match|mismatch/i.test(text));
    expect(hydrationProblems).toEqual([]);
  });
});
