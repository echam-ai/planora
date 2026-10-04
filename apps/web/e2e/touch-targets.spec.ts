import { expect, test } from "@playwright/test";
import { openTaskSheet, signIn } from "./helpers";
import { expectNoHorizontalScroll, expectSeparateBoxes, expectTouchTargets } from "./touch-targets";

// Sixteen states, on both projects; no mobile/desktop skips or weakened geometry checks.
test("touch targets: password page", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Unlock" })).toBeEnabled();
  await expectNoHorizontalScroll(page, "1: password page");
  await expectTouchTargets(page, "1: password page");
});

test("touch targets: filtered board and account menu", async ({ page }) => {
  await signIn(page);
  const toolbar = page.getByRole("region", { name: "Board filters" });
  const measureToolbar = async () => {
    const box = await toolbar.boundingBox();
    const search = await toolbar.getByRole("textbox", { name: "Search tasks" }).boundingBox();
    expect(box).not.toBeNull();
    expect(search).not.toBeNull();
    const desktop = page.viewportSize()!.width >= 640;
    expect(box!.height).toBeLessThanOrEqual(desktop ? 64 : 112);
    if (desktop) expect(search!.width).toBeCloseTo(288, 0);
    const triggers = toolbar.getByRole("button", { name: /^(Category|Priority|Deadline)( \d+)?$/ });
    const boxes = [];
    for (const trigger of await triggers.all()) {
      const triggerBox = await trigger.boundingBox();
      expect(triggerBox).not.toBeNull();
      expect(triggerBox!.width).toBeLessThan(144);
      if (desktop) expect(triggerBox!.y).toBeCloseTo(search!.y, 0);
      else expect(triggerBox!.y).toBeGreaterThanOrEqual(search!.y + search!.height);
      boxes.push(triggerBox!);
    }
    expect(boxes).toHaveLength(3);
    expect(boxes[0]!.y).toBeCloseTo(boxes[2]!.y, 0);
    const reset = toolbar.getByRole("button", { name: "Clear all filters" });
    if (await reset.count()) {
      expect((await reset.boundingBox())!.y).toBeCloseTo(search!.y, 0);
    }
    const controls = [toolbar.getByRole("textbox"), ...(await toolbar.getByRole("button").all())];
    for (let first = 0; first < controls.length; first++) {
      for (let second = first + 1; second < controls.length; second++) {
        await expectSeparateBoxes(
          controls[first]!,
          controls[second]!,
          "toolbar controls never overlap",
        );
      }
    }
    await expectTouchTargets(page, "compact toolbar", toolbar);
    await expectNoHorizontalScroll(page, "compact toolbar");
    return box!;
  };
  await measureToolbar();
  for (const [dimension, options] of [
    ["Category", ["Work", "Personal"]],
    ["Priority", ["High", "Low"]],
    ["Deadline", ["No deadline", "Scheduled"]],
  ] as const) {
    const before = await toolbar.boundingBox();
    await toolbar.getByRole("button", { name: dimension, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `${dimension} filters` });
    await expect(dialog).toBeVisible();
    const overlay = await dialog.boundingBox();
    expect(overlay).not.toBeNull();
    expect(overlay!.x).toBeGreaterThanOrEqual(0);
    expect(overlay!.x + overlay!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(overlay!.y).toBeGreaterThanOrEqual(0);
    expect(overlay!.y + overlay!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect((await toolbar.boundingBox())!.height).toEqual(before!.height);
    await expectTouchTargets(page, `${dimension} popover`, dialog);
    for (const option of options)
      await dialog.getByRole("button", { name: option, exact: true }).click();
    await page.keyboard.press("Escape");
  }
  await toolbar.getByRole("textbox").fill("No matching task");
  await measureToolbar();
  await expect(page.getByRole("button", { name: "Clear all filters" })).toBeVisible();
  await expectTouchTargets(page, "2: filtered board");
  await expectNoHorizontalScroll(page, "2: filtered board");
  await page.getByRole("button", { name: "Clear all filters" }).click();
  for (const handle of await page.getByRole("button", { name: /^Drag / }).all()) {
    const title = handle.locator("..").getByRole("heading", { level: 3 });
    await expectSeparateBoxes(handle, title, "drag handle must be clear of each seed title");
  }
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Switch account" })).toBeVisible();
  await expectTouchTargets(page, "3: account menu");
});

test("touch targets: quick capture, failed parse, form, calendar and category", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a task" });
  await expect(dialog).toBeVisible();
  await expectTouchTargets(page, "4: quick capture");
  await expectSeparateBoxes(
    dialog.getByRole("button", { name: "Close", exact: true }),
    dialog.getByRole("heading", { name: "Add a task" }),
    "dialog Close must be clear of its title",
  );
  await dialog.getByLabel("Describe the task in your own words").fill("fail to parse this task");
  await dialog.getByRole("button", { name: "Parse task" }).click();
  await expect(dialog.getByRole("button", { name: "Continue in the form instead" })).toBeVisible();
  await expectTouchTargets(page, "5: failed parse");
  await dialog.getByRole("tab", { name: "Task form" }).click();
  await expect(dialog.getByLabel("Date")).toBeVisible();
  await dialog.getByRole("button", { name: "Add link" }).click();
  await expect(dialog.getByRole("button", { name: "Remove link" })).toBeVisible();
  await expectTouchTargets(page, "6: task form with link row");
  await expectNoHorizontalScroll(page, "6: task form");
  await dialog.getByLabel("Date").click();
  await expect(page.locator('[data-slot="calendar"]')).toBeVisible();
  await expectTouchTargets(page, "7: date picker");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="calendar"]')).toBeHidden();
  await dialog.getByRole("combobox", { name: "Category" }).click();
  await expect(page.getByRole("option", { name: "Work", exact: true })).toBeVisible();
  await expectTouchTargets(page, "8: Category select");
});

test("touch targets: task detail and delete confirmation", async ({ page }) => {
  await signIn(page);
  const dialog = await openTaskSheet(page, "Read chapter 4 of the distributed systems book");
  await expectTouchTargets(page, "9: task detail");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectTouchTargets(page, "10: delete confirmation");
});

test("touch targets: empty chat, proposal, new conversation and failed send", async ({ page }) => {
  await signIn(page);
  await page.getByRole("banner").getByRole("button", { name: "AI Assistant", exact: true }).click();
  await expect(page.getByText(/I never change anything without your confirmation/)).toBeVisible();
  await expectTouchTargets(page, "11: empty chat (desktop side panel or mobile drawer)");
  await expectNoHorizontalScroll(page, "11: empty chat");
  await page
    .getByRole("button", { name: "Add a task to review my notes tomorrow at 8 PM", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
  await expectTouchTargets(page, "12: proposal card");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "Start a new conversation?" })).toBeVisible();
  await expectTouchTargets(page, "13: new conversation confirmation");
  await page.getByRole("button", { name: "Keep chat" }).click();
  await page.evaluate(() => window.localStorage.setItem("planora.forceError", "true"));
  await page.getByLabel("Message the assistant").fill("What is overdue?");
  await page.getByLabel("Message the assistant").press("Enter");
  await expect(page.getByText(/The assistant didn't respond/)).toBeVisible();
  await expectTouchTargets(page, "14: chat failure notice");
});

test("touch targets: archive and settings", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Archive", exact: true })).toBeVisible();
  await expectTouchTargets(page, "15: archive");
  await page.getByRole("link", { name: "Settings", exact: true }).first().click();
  await expect(page.getByRole("combobox", { name: "Timezone" })).toBeVisible();
  await expectTouchTargets(page, "16: settings");
});

test("390px active filters keep two rows with wider fallback font metrics", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const toolbar = page.getByRole("region", { name: "Board filters" });
  // Outfit is named but not bundled. Exercise wider glyphs deterministically,
  // rather than letting the host's system font decide whether this test wraps.
  await toolbar.evaluate((element) => {
    element.style.fontFamily = "monospace";
  });
  await toolbar.getByRole("textbox").fill("No matching task");
  for (const [dimension, option] of [
    ["Category", "Work"],
    ["Priority", "High"],
    ["Deadline", "No deadline"],
  ] as const) {
    await toolbar.getByRole("button", { name: dimension, exact: true }).click();
    await page.getByRole("button", { name: option, exact: true }).click();
    await page.keyboard.press("Escape");
  }
  const box = await toolbar.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(112);
  const triggers = await toolbar
    .getByRole("button", { name: /^(Category|Priority|Deadline) 1$/ })
    .all();
  const boxes = await Promise.all(triggers.map((trigger) => trigger.boundingBox()));
  expect(boxes).toHaveLength(3);
  expect(boxes[0]!.y).toEqual(boxes[2]!.y);
  for (const trigger of triggers) {
    await expect(trigger).toHaveAccessibleDescription(/^Selected: /);
    expect(await trigger.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  }
  for (let first = 0; first < triggers.length; first++) {
    for (let second = first + 1; second < triggers.length; second++) {
      await expectSeparateBoxes(
        triggers[first]!,
        triggers[second]!,
        "fallback-font triggers stay separate",
      );
    }
  }
  await expectTouchTargets(page, "390px fallback-font active toolbar", toolbar);
  await expectNoHorizontalScroll(page, "390px fallback-font active toolbar");
});

for (const width of [390, 320]) {
  test(`filter popovers fit ${width}px and scroll within a short viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await signIn(page);
    const header = page.getByRole("banner");
    const headerControls = [
      header.getByRole("link", { name: "Planora" }),
      header.getByRole("button", { name: "Add task", exact: true }),
      header.getByRole("button", { name: "AI Assistant", exact: true }),
      header.getByRole("link", { name: "Settings", exact: true }),
      header.getByRole("button", { name: "Account menu", exact: true }),
    ];
    for (const control of headerControls) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    for (let first = 0; first < headerControls.length; first++) {
      for (let second = first + 1; second < headerControls.length; second++) {
        await expectSeparateBoxes(
          headerControls[first]!,
          headerControls[second]!,
          `${width}px header controls stay separate`,
        );
      }
    }
    await expectTouchTargets(page, `${width}px header`, header);
    await expect(page.getByRole("navigation", { name: "Main mobile" })).toBeVisible();
    await header.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByRole("menuitem", { name: "Switch account" })).toBeVisible();
    await expectTouchTargets(page, `${width}px account menu`, page.getByRole("menu"));
    await expectNoHorizontalScroll(page, `${width}px account menu`);
    await page.keyboard.press("Escape");
    const toolbar = page.getByRole("region", { name: "Board filters" });
    await toolbar.getByRole("textbox").fill("No matching task");
    for (const [dimension, option] of [
      ["Category", "Work"],
      ["Priority", "High"],
      ["Deadline", "No deadline"],
    ] as const) {
      await toolbar.getByRole("button", { name: dimension, exact: true }).click();
      await page.getByRole("button", { name: option, exact: true }).click();
      await page.keyboard.press("Escape");
    }
    if (width === 390) expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(112);
    await expectNoHorizontalScroll(page, `${width}px active toolbar`);
    await expectTouchTargets(page, `${width}px active toolbar`, toolbar);
    const controls = [toolbar.getByRole("textbox"), ...(await toolbar.getByRole("button").all())];
    for (let first = 0; first < controls.length; first++) {
      for (let second = first + 1; second < controls.length; second++)
        await expectSeparateBoxes(
          controls[first]!,
          controls[second]!,
          `${width}px controls stay separate`,
        );
    }
    await page.setViewportSize({ width, height: 240 });
    for (const dimension of ["Category", "Priority", "Deadline"]) {
      const trigger = toolbar.getByRole("button", { name: `${dimension} 1`, exact: true });
      await trigger.scrollIntoViewIfNeeded();
      const before = await toolbar.boundingBox();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: `${dimension} filters` });
      await expect(dialog).toBeVisible();
      // Finish the primitive's finite entrance animation before geometry inspection.
      await expectTouchTargets(page, `${width}px short ${dimension}`, dialog);
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(240);
      expect((await toolbar.boundingBox())!.height).toEqual(before!.height);
      expect(await dialog.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
        true,
      );
      for (const option of await dialog.getByRole("button").all()) {
        await option.scrollIntoViewIfNeeded();
        const optionBox = await option.boundingBox();
        const viewportBox = await dialog.boundingBox();
        expect(optionBox!.y).toBeGreaterThanOrEqual(viewportBox!.y);
        expect(optionBox!.y + optionBox!.height).toBeLessThanOrEqual(
          viewportBox!.y + viewportBox!.height,
        );
      }
      await dialog.getByRole("button", { name: `Close ${dimension} filters` }).click();
      await expect(trigger).toBeFocused();
      await expectNoHorizontalScroll(page, `${width}px short viewport`);
    }
  });
}
