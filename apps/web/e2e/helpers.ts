import { expect, type Locator, type Page } from "@playwright/test";

export async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Hamster Knight" }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
}

export function card(page: Page, title: string) {
  return page.getByRole("button", { name: `Open task ${title}`, exact: true });
}

export function column(page: Page, label: string) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: label }) });
}

export function detailSheet(page: Page) {
  return page.getByRole("dialog");
}

export function statusControl(page: Page) {
  return detailSheet(page).getByRole("combobox", { name: "Status" });
}

/** The stored completion timestamp — the sheet formats it in the user's timezone. */
export async function readCompletedAt(page: Page, title: string): Promise<string | null> {
  return page.evaluate((t) => {
    const tasks = JSON.parse(
      window.localStorage.getItem("planora.hamster_knight.tasks") ?? "[]",
    ) as Array<{
      title: string;
      completedAt: string | null;
    }>;
    return tasks.find((x) => x.title === t)?.completedAt ?? null;
  }, title);
}

/** Open a task's detail sheet once the board has stopped refetching, and
 * wait for its embedded `TaskForm` to resolve the Settings timezone query.
 *
 * `TaskForm` renders "Loading your timezone…" (`aria-busy`) until
 * `useSettings()` resolves, then swaps in the Date/Time fields. Every caller
 * that immediately asserts on those fields is racing that query — normally
 * it has already resolved (Board fetches the same cached query on load),
 * but under CPU contention (a full, parallel `--repeat-each` run) the race
 * can outlast an assertion's default timeout. Waiting for this named,
 * observable ready state here means every spec that opens a task sheet
 * benefits, instead of a one-off wait bolted onto a single scenario.
 */
export async function openTaskSheet(page: Page, title: string) {
  await settleBoard(page);
  await card(page, title).click();
  const dialog = detailSheet(page);
  await expect(dialog.getByText("Loading your timezone…")).toBeHidden();
  await expect(dialog.getByLabel("Date")).toBeVisible();
  return dialog;
}

function cardInColumn(page: Page, title: string, toColumn: string): Locator {
  return column(page, toColumn).getByRole("button", { name: `Open task ${title}`, exact: true });
}

/** Mouse-drag once by the grip, synchronizing on geometry rather than timed pauses. */
export async function dragCardToColumn(page: Page, title: string, toColumn: string) {
  await settleBoard(page);
  await dragOnce(page, title, toColumn);
  await expect(cardInColumn(page, title, toColumn)).toBeVisible();
}

/** The board is not being refetched right now. */
export async function settleBoard(page: Page) {
  await expect(page.locator('img[aria-label="Refreshing"]')).toBeHidden();
}

/** Scroll/auto-scroll and layout transitions must stop moving the measured element. */
async function waitForStableBox(locator: Locator) {
  await locator.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        let previous = el.getBoundingClientRect();
        let stableFrames = 0;
        const measure = () => {
          const current = el.getBoundingClientRect();
          stableFrames =
            current.x === previous.x &&
            current.y === previous.y &&
            current.width === previous.width &&
            current.height === previous.height
              ? stableFrames + 1
              : 0;
          previous = current;
          if (stableFrames >= 2) resolve();
          else requestAnimationFrame(measure);
        };
        requestAnimationFrame(measure);
      }),
  );
}

async function dragOnce(page: Page, title: string, toColumn: string) {
  const handle = page.getByRole("button", { name: `Drag ${title}`, exact: true });
  await handle.scrollIntoViewIfNeeded();
  await waitForStableBox(handle);
  const from = await handle.boundingBox();
  const viewport = page.viewportSize();
  if (!from || !viewport) throw new Error("drag handle or viewport has no box");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8, { steps: 4 });
  // Park outside auto-scroll's edge zones, then wheel the target into view.
  // One pointer gesture stays active across the scroll, including on mobile.
  await page.mouse.move(viewport.width / 2, viewport.height / 2, { steps: 4 });
  const target = column(page, toColumn);
  const heading = target.getByRole("heading", { name: toColumn, exact: true });
  const initialHeading = await heading.boundingBox();
  if (!initialHeading) throw new Error("target column heading has no box");
  if (initialHeading.y < 110 || initialHeading.y > viewport.height - 200) {
    const previousScroll = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, initialHeading.y - 150);
    await expect.poll(() => page.evaluate(() => window.scrollY)).not.toBe(previousScroll);
  }
  await waitForStableBox(target);
  const to = await target.boundingBox();
  if (!to) throw new Error("target column has no box");
  const dropX = to.x + to.width / 2;
  const dropY = Math.max(150, to.y + 64);
  expect(dropX).toBeGreaterThan(8);
  expect(dropX).toBeLessThan(viewport.width - 8);
  expect(dropY).toBeGreaterThan(to.y);
  expect(dropY).toBeLessThan(Math.min(to.y + to.height, viewport.height - 100));
  await page.mouse.move(dropX, dropY, { steps: 8 });
  await waitForStableBox(target);
  await page.mouse.up();
}
