import { expect, test } from "@playwright/test";
import { card, signIn } from "./helpers";

const OVERDUE = "Ship the search-quality review deck";

test("a card's button keeps its short name and is described by its badges", async ({ page }) => {
  await signIn(page);
  const button = card(page, OVERDUE);
  await expect(button).toHaveAccessibleName(`Open task ${OVERDUE}`);
  await expect(button).toHaveAccessibleDescription(/Overdue/);
  await expect(button).toHaveAccessibleDescription(/ priority/);
  await expect(button).toHaveAccessibleDescription(/\b(Work|Personal|Study|Other)\b/);
});

test("every aria-describedby id resolves to one element while a card is being dragged", async ({
  page,
}) => {
  await signIn(page);
  const handle = page.getByRole("button", { name: `Drag ${OVERDUE}`, exact: true });
  await handle.focus();
  await page.keyboard.press("Space");
  // The DragOverlay copy is now rendered alongside the original card.
  await expect(page.getByText(OVERDUE, { exact: true })).toHaveCount(2);

  const unresolved = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll("[aria-describedby]")) {
      for (const id of (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)) {
        if (document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length !== 1) bad.push(id);
      }
    }
    return bad;
  });
  expect(unresolved).toEqual([]);
  await page.keyboard.press("Escape");
});
