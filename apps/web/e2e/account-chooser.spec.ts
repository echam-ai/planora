import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectTouchTargets } from "./touch-targets";
import { unlock } from "./unlock";

const option = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("button", { name, exact: true });

test.describe("illustrated account chooser (#122)", () => {
  test("each account is one named button with its own aria-hidden inline illustration", async ({
    page,
  }) => {
    await unlock(page);
    await expect(page.getByRole("heading", { name: "Choose your account" })).toBeVisible();
    await expect(page.getByText(/Two separate workspaces/)).toBeVisible();
    await expect(page.getByRole("button")).toHaveCount(2);

    const hamster = option(page, "Hamster Knight");
    const princess = option(page, "Ech Princess");
    await expect(hamster.locator('svg[aria-hidden="true"][data-mascot="hamster"]')).toBeVisible();
    await expect(princess.locator('svg[aria-hidden="true"][data-mascot="frog"]')).toBeVisible();
    await expect(hamster.locator('[data-part="helmet"]')).toHaveCount(1);
    await expect(princess.locator('[data-part="crown"]')).toHaveCount(1);
  });

  test("loading / and /tasks contacts no origin but the app's own", async ({ page, baseURL }) => {
    const origins = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol === "http:" || url.protocol === "https:") origins.add(url.origin);
    });
    await unlock(page);
    await option(page, "Hamster Knight").click();
    await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect([...origins]).toEqual([new URL(baseURL!).origin]);
  });

  test("at 360px the chooser has no horizontal overflow and big touch targets", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await unlock(page);
    await expect(option(page, "Hamster Knight")).toBeVisible();
    await expectNoHorizontalScroll(page, "chooser at 360px");
    await expectTouchTargets(page, "chooser at 360px");
    const [hamster, princess] = [
      await option(page, "Hamster Knight").boundingBox(),
      await option(page, "Ech Princess").boundingBox(),
    ];
    // Stacked on a phone.
    expect(princess!.y).toBeGreaterThan(hamster!.y + hamster!.height - 1);
  });

  test("at 1280px the two options sit side by side", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await unlock(page);
    const hamster = (await option(page, "Hamster Knight").boundingBox())!;
    const princess = (await option(page, "Ech Princess").boundingBox())!;
    expect(Math.abs(hamster.y - princess.y)).toBeLessThan(2);
    expect(princess.x).toBeGreaterThan(hamster.x + hamster.width - 1);
    await expectNoHorizontalScroll(page, "chooser at 1280px");
  });

  test("choosing Ech Princess shows her illustration and name in the header", async ({ page }) => {
    await unlock(page);
    await option(page, "Ech Princess").click();
    await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();

    const banner = page.getByRole("banner");
    const trigger = banner.getByRole("button", { name: "Account menu" });
    await expect(trigger.locator('svg[aria-hidden="true"][data-mascot="frog"]')).toBeVisible();
    await expect(trigger).not.toContainText("EP");
    await expect(banner.getByLabel("Selected account")).toHaveText("Ech Princess");
  });
});
