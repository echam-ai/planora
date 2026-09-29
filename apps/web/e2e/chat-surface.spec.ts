import { expect, test, type Locator, type Page } from "@playwright/test";
import { openTaskSheet, signIn } from "./helpers";

/**
 * Regression for #62.
 *
 * AppShell always mounted the mobile chat `<Sheet>` (its Radix dialog, full
 * viewport overlay, and `aria-hidden`-the-rest-of-the-page side effect)
 * whenever the assistant was open, even at desktop widths where only the
 * docked side panel should be interactive. The overlay then sat on top of the
 * side panel and the board, intercepting pointer input while visually dimming
 * everything beneath it.
 *
 * These specs only ever use a real pointer action — Playwright locator
 * `click()` without `force`, or `page.mouse.click()` at a specific viewport
 * point. None uses a DOM `.click()`, `dispatchEvent`, or `page.evaluate`
 * click: a programmatic click reaches its target regardless of an overlay
 * sitting on top of it, which is exactly how this bug escaped earlier tests
 * (see the #62 issue body). `page.evaluate` is used below only to read
 * `aria-hidden`/`inert` state, never to dispatch a click.
 */

const chatButton = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: "AI Assistant", exact: true });
const chatDialog = (page: Page) => page.getByRole("dialog", { name: "AI Assistant" });

/** Whether `main` or any of its ancestors is `aria-hidden` or `inert`. */
async function mainIsHiddenFromAssistiveTech(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    let el = document.querySelector("main") as HTMLElement | null;
    while (el) {
      if (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("inert")) return true;
      el = el.parentElement;
    }
    return false;
  });
}

/** Whether the currently focused element is inside the given container. */
async function activeElementIsInside(page: Page, containerSelector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const container = document.querySelector(sel);
    return !!container && container.contains(document.activeElement);
  }, containerSelector);
}

/**
 * Waits for the drawer's own open animation to finish, then returns its
 * settled bounding box.
 *
 * The slide-in is a `tw-animate-css` keyframe *animation* (`animate-in`), not
 * a transition, so `transitionend` is the wrong signal: it bubbles, and a
 * descendant's `outline-color` focus-ring transition (the first focusable
 * `buttonVariants` button in the drawer, #81) fired mid-slide and resolved the
 * wait early, giving a box that still overlapped the final panel (#108). The
 * Web Animations API reports the element's own animations and transitions and
 * ignores anything a descendant runs, so nothing here depends on event
 * bubbling or on the animation's duration. The trailing assertions make a
 * box measured mid-animation fail instead of yielding a click inside the
 * panel.
 */
async function settledBoundingBox(locator: Locator) {
  await locator.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)).then(() => undefined),
  );
  expect(
    await locator.evaluate((el) => el.getAnimations().length),
    "the drawer's own animations must have finished before it is measured",
  ).toBe(0);
  const box = await locator.boundingBox();
  if (!box) throw new Error("drawer panel has no bounding box");
  expect(await locator.boundingBox(), "the settled drawer box must not still be moving").toEqual(
    box,
  );
  return box;
}

/**
 * Real pointer click at a point measured to be outside the settled drawer
 * panel. The drawer is anchored to the right (`side="right"`), so a point a
 * few pixels left of its measured left edge is always outside the panel and
 * inside the Sheet overlay — regardless of how wide the panel itself is.
 */
async function clickOutsideDrawer(page: Page, dialog: Locator) {
  const box = await settledBoundingBox(dialog);
  expect(box.x, "the drawer must leave some overlay exposed at this width").toBeGreaterThan(0);
  const clickX = Math.max(0, box.x - 10);
  expect(clickX, "the click point must lie outside the settled drawer box").toBeLessThan(box.x);
  await page.mouse.click(clickX, box.y + box.height / 2);
}

test.describe("desktop side panel (>=1024px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("scenario: user chats with the side panel on desktop", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile-chromium",
      "requires the >=1024px desktop layout; mobile-chromium emulates a narrower viewport",
    );
    await signIn(page);
    await chatButton(page).click();

    // No mobile dialog/overlay ever mounts at this width.
    await expect(chatDialog(page)).toHaveCount(0);
    expect(await mainIsHiddenFromAssistiveTech(page)).toBe(false);

    const input = page.locator("#chat-input");
    await expect(input).toBeVisible();
    await input.click();
    await expect(input).toBeFocused();
    await input.fill("Real pointer click reaches the desktop panel");
    await input.press("Enter");
    await expect(page.getByText("Real pointer click reaches the desktop panel")).toBeVisible();
  });

  test("scenario: user uses the board while the assistant is open on desktop", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile-chromium",
      "requires the >=1024px desktop layout; mobile-chromium emulates a narrower viewport",
    );
    await signIn(page);
    await chatButton(page).click();
    await expect(page.locator("#chat-input")).toBeVisible();

    expect(await mainIsHiddenFromAssistiveTech(page)).toBe(false);

    const dialog = await openTaskSheet(page, "Draft Q4 hiring plan");
    await expect(dialog).toBeVisible();
  });
});

test.describe("mobile drawer (<1024px)", () => {
  test("scenario: user opens and dismisses the drawer on mobile", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name === "chromium",
      "requires the <1024px drawer layout; chromium's default viewport here is desktop width",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    const trigger = chatButton(page);
    await trigger.click();

    const dialog = chatDialog(page);
    await expect(dialog).toBeVisible();
    expect(await activeElementIsInside(page, '[role="dialog"]')).toBe(true);

    // Tab/Shift+Tab cycling never lets focus leave the drawer.
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press("Tab");
      expect(await activeElementIsInside(page, '[role="dialog"]')).toBe(true);
    }
    await page.keyboard.press("Shift+Tab");
    expect(await activeElementIsInside(page, '[role="dialog"]')).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(dialog).toBeVisible();

    await clickOutsideDrawer(page, dialog);
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-pressed", "false");
  });

  test("scenario: a real pointer click outside the drawer closes it at 360px width", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "chromium",
      "requires the <1024px drawer layout; chromium's default viewport here is desktop width",
    );
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page);
    const trigger = chatButton(page);
    await trigger.click();

    const dialog = chatDialog(page);
    await expect(dialog).toBeVisible();

    await clickOutsideDrawer(page, dialog);
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-pressed", "false");
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    test(`scenario: the drawer has one 44px close control at ${viewport.width}x${viewport.height}`, async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name === "chromium",
        "requires the <1024px drawer layout; chromium's default viewport here is desktop width",
      );
      await page.setViewportSize(viewport);
      await signIn(page);
      const trigger = chatButton(page);
      await trigger.click();

      const dialog = chatDialog(page);
      await expect(dialog).toBeVisible();
      const closes = dialog.getByRole("button", { name: /close/i });
      await expect(closes).toHaveCount(1);
      const close = dialog.getByRole("button", { name: "Close assistant", exact: true });
      await expect(close).toBeVisible();

      const dialogBox = await settledBoundingBox(dialog);
      const box = await close.boundingBox();
      if (!box) throw new Error("close button has no bounding box");
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(dialogBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
      expect(box.y).toBeGreaterThanOrEqual(dialogBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height);

      await close.click();
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-pressed", "false");
    });
  }

  test("scenario: keyboard user closes the drawer with Enter on Close assistant", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "chromium",
      "requires the <1024px drawer layout; chromium's default viewport here is desktop width",
    );
    await signIn(page);
    const trigger = chatButton(page);
    await trigger.click();

    const dialog = chatDialog(page);
    await expect(dialog).toBeVisible();
    const close = dialog.getByRole("button", { name: "Close assistant", exact: true });
    for (let i = 0; i < 10; i += 1) {
      if (await close.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(close).toBeFocused();
    // The focus-visible ring from buttonVariants renders as a box-shadow.
    expect(await close.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");

    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("resize across the 1024px breakpoint", () => {
  test("scenario: resizing keeps the conversation and swaps surfaces", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile-chromium",
      "exercises page.setViewportSize; mobile-chromium's fixed device emulation does not resize meaningfully",
    );
    await page.setViewportSize({ width: 800, height: 800 });
    await signIn(page);
    await chatButton(page).click();
    await expect(chatDialog(page)).toBeVisible();

    const drawerInput = page.locator("#chat-input");
    await drawerInput.click();
    await drawerInput.fill("Message survives the resize");
    await drawerInput.press("Enter");
    await expect(page.getByText("Message survives the resize")).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(chatDialog(page)).toHaveCount(0);
    await expect(page.getByText("Message survives the resize")).toBeVisible();
    expect(await mainIsHiddenFromAssistiveTech(page)).toBe(false);

    const dialog = await openTaskSheet(page, "Draft Q4 hiring plan");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.setViewportSize({ width: 800, height: 800 });
    await expect(chatDialog(page)).toBeVisible();
    await expect(page.getByText("Message survives the resize")).toBeVisible();
  });
});
