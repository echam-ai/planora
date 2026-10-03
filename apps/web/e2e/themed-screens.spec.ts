import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";
import { expectNoHorizontalScroll, expectTouchTargets, settleAnimations } from "./touch-targets";
import { expectTheme, seedTheme, type ThemeName } from "./theme";

const themes: ThemeName[] = ["light", "dark", "colorful"];
const screens = [
  {
    path: "/tasks",
    ready: (page: import("@playwright/test").Page) => page.getByRole("heading", { name: "To do" }),
  },
  {
    path: "/archive",
    ready: (page: import("@playwright/test").Page) =>
      page.getByRole("heading", { name: "Archive", exact: true }),
  },
  {
    path: "/settings",
    ready: (page: import("@playwright/test").Page) =>
      page.getByRole("combobox", { name: "Timezone" }),
  },
];

for (const theme of themes) {
  test.describe(`${theme} theme at phone width (#122)`, () => {
    for (const screen of screens) {
      test(`${screen.path}: no overflow, 44px targets, account name visible in the banner`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await seedTheme(page, theme);
        await signIn(page);
        await page.goto(screen.path);
        await expect(screen.ready(page)).toBeVisible();
        await expectTheme(page, theme);

        const name = page.getByRole("banner").getByLabel("Selected account");
        await expect(name).toBeVisible();
        await expect(name).toHaveText("Hamster Knight");
        const box = (await name.boundingBox())!;
        expect(box.width).toBeGreaterThan(24);

        await expectNoHorizontalScroll(page, `${screen.path} in ${theme}`);
        await expectTouchTargets(page, `${screen.path} in ${theme}`);
      });
    }
  });
}

test("the selected account's name is visible in the banner on every route and width", async ({
  page,
}) => {
  await signIn(page);
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/tasks", "/archive", "/settings"]) {
      await page.goto(path);
      const name = page.getByRole("banner").getByLabel("Selected account");
      await expect(name, `${path} at ${width}px`).toHaveText("Hamster Knight");
      await expect(name, `${path} at ${width}px`).toBeVisible();
      // Wider than a phone, the name is never cut off.
      if (width >= 640) {
        const fits = await name.evaluate((el) => el.scrollWidth <= el.clientWidth);
        expect(fits, `${path} at ${width}px must not truncate`).toBe(true);
      }
    }
  }
});

test("theme controls are at least 44x44 at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(4);
  await settleAnimations(page);
  for (const item of await page.getByRole("menuitemradio").all()) {
    const box = (await item.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press("Escape");

  await page.goto("/settings");
  const radios = page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio");
  await expect(radios).toHaveCount(4);
  for (const radio of await radios.all()) {
    const box = (await radio.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expectTouchTargets(page, "settings theme group", page.getByRole("radiogroup"));
});
