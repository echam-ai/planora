import { expect, type Locator, type Page } from "@playwright/test";

/** Wait for finite entrance/exit animations before measuring their transformed boxes. */
export async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ).then(() => undefined),
  );
}

/** Every visible control, including disabled ones and visible modal backgrounds. */
export async function expectTouchTargets(page: Page, state: string, scope: Page | Locator = page) {
  await settleAnimations(page);
  const offenders: string[] = [];
  const roles = ["button", "link", "tab", "combobox", "checkbox", "menuitem", "option"] as const;
  for (const role of [...roles, "input", "textarea"] as const) {
    const controls =
      role === "input" || role === "textarea"
        ? scope.locator(role)
        : scope.getByRole(role, { includeHidden: true });
    for (const control of await controls.all()) {
      if (!(await control.isVisible())) continue;
      // isVisible considers a clipped 1px native form mirror visible. Check actual
      // painting too, without excluding visibly painted aria-hidden backgrounds.
      const clippedAway = await control.evaluate((el) => {
        let current: Element | null = el;
        while (current) {
          const style = getComputedStyle(current);
          if (
            style.clip.replace(/\s/g, "") === "rect(0px,0px,0px,0px)" ||
            style.clipPath === "inset(100%)"
          )
            return true;
          current = current.parentElement;
        }
        return false;
      });
      if (clippedAway) continue;
      // WCAG 2.5.8's inline exception: prose links follow their sentence's line box.
      // This is the only exemption; other Markdown controls remain measured.
      if (role === "link" && (await control.evaluate((el) => !!el.closest(".prose-planora"))))
        continue;
      const box = await control.boundingBox();
      if (box && box.width >= 44 && box.height >= 44) continue;
      const snapshot = await control.ariaSnapshot();
      const name =
        snapshot.split("\n")[0] ||
        (await control.evaluate((el) => {
          const labelledBy = el
            .getAttribute("aria-labelledby")
            ?.split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ");
          const labels = (el as HTMLInputElement).labels;
          return (
            el.getAttribute("aria-label") ||
            labelledBy ||
            (labels
              ? Array.from(labels)
                  .map((label) => label.textContent)
                  .join(" ")
              : "") ||
            el.textContent?.trim() ||
            "(unnamed)"
          );
        }));
      offenders.push(
        `${role}: ${name}: ${box ? `${box.width.toFixed(2)}×${box.height.toFixed(2)}` : "no box"} CSS px`,
      );
    }
  }
  expect
    .soft(offenders, `${state}: all visible controls need 44×44 CSS px\n${offenders.join("\n")}`)
    .toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page, state: string) {
  const size = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect.soft(size.scroll, `${state}: horizontal page overflow`).toBeLessThanOrEqual(size.client);
}

export async function expectSeparateBoxes(first: Locator, second: Locator, message: string) {
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  expect(a, message).not.toBeNull();
  expect(b, message).not.toBeNull();
  if (!a || !b) return;
  const overlaps =
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect.soft(overlaps, message).toBe(false);
}
