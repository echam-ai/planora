import { expect, type Page } from "@playwright/test";

export const THEME_KEY = "planora.theme";
export type ThemeName = "light" | "dark" | "colorful";

/** Seed the stored theme once per browser context; a later choice in the UI is not overwritten. */
export async function seedTheme(page: Page, value: string) {
  await page.addInitScript(
    ([key, theme]) => {
      if (window.localStorage.getItem(key!) === null) window.localStorage.setItem(key!, theme!);
    },
    [THEME_KEY, value],
  );
}

export function html(page: Page) {
  return page.locator("html");
}

export async function expectTheme(page: Page, theme: ThemeName) {
  await expect(html(page)).toHaveAttribute("data-theme", theme);
}

export async function storedTheme(page: Page) {
  return page.evaluate((key) => window.localStorage.getItem(key), THEME_KEY);
}

/** The computed `background-color` a surface takes in `theme`, read from a throwaway probe. */
export async function themeBackground(page: Page, theme: ThemeName) {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.setAttribute("data-theme", name);
    probe.style.backgroundColor = "var(--background)";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, theme);
}
