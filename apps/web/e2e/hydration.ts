import type { Page } from "@playwright/test";

// Shared by specs that type into a server-rendered form before hydration (#112, #113).

/** Park every script request until `release()` is called. */
export async function holdScripts(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await gate;
    await route.continue().catch(() => {});
  });
  return release;
}

/** React attaches a `__reactFiber$` key to a DOM node once it has hydrated it. */
export async function expectHydrated(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
  }, selector);
}
