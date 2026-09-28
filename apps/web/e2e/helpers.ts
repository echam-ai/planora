import { expect, type Locator, type Page } from "@playwright/test";

export async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("focusboard");
  await page.getByRole("button", { name: "Sign in" }).click();
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
    const tasks = JSON.parse(window.localStorage.getItem("planora.tasks") ?? "[]") as Array<{
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

/**
 * Mouse-drag a card by its grip handle into a column.
 *
 * Two races make this fiddly: dnd-kit's auto-scroll keeps scrolling while the
 * pointer rests in a scroll zone (which slides the columns out from under a
 * precomputed drop point), and focus-driven refetches can re-render — and
 * re-parent — the cards mid-interaction. So the drag parks the pointer
 * mid-viewport, measures, moves to the target and re-checks before releasing,
 * and each retry waits for the board to settle and for the drop to land.
 */
export async function dragCardToColumn(page: Page, title: string, toColumn: string) {
  const landed = cardInColumn(page, title, toColumn);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await settleBoard(page);
    if ((await landed.count()) > 0) {
      await expect(landed).toBeVisible();
      return;
    }
    await dragOnce(page, title, toColumn);
    if (await eventuallyVisible(landed)) return;
  }
  throw new Error(`could not drag "${title}" into "${toColumn}"`);
}

/** The board is not being refetched right now. */
export async function settleBoard(page: Page) {
  await expect(page.locator('img[aria-label="Refreshing"]')).toBeHidden();
}

async function eventuallyVisible(locator: Locator, timeout = 4_000): Promise<boolean> {
  return await locator
    .first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

async function dragOnce(page: Page, title: string, toColumn: string) {
  const handle = page.getByRole("button", { name: `Drag ${title}`, exact: true });
  await handle.scrollIntoViewIfNeeded();
  // Let the scroll settle before measuring: pressing a stale box never
  // activates the drag.
  await page.waitForTimeout(350);
  const from = await handle.boundingBox();
  const viewport = page.viewportSize();
  if (!from || !viewport) throw new Error("drag handle or viewport has no box");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8, { steps: 4 });

  const target = column(page, toColumn);
  for (let i = 0; i < 40; i += 1) {
    // Park mid-viewport so auto-scroll settles before measuring the target.
    await page.mouse.move(viewport.width / 2, viewport.height / 2, { steps: 4 });
    await page.waitForTimeout(150);

    const to = await target.boundingBox();
    if (to) {
      const dropX = to.x + to.width / 2;
      const dropY = to.y + Math.min(to.height - 20, Math.max(56, to.height * 0.25));
      const safe =
        dropX > 8 && dropX < viewport.width - 8 && dropY > 110 && dropY < viewport.height - 130;
      if (safe) {
        await page.mouse.move(dropX, dropY, { steps: 8 });
        await page.waitForTimeout(120);
        const settled = await target.boundingBox();
        const stillInside =
          settled &&
          dropX >= settled.x &&
          dropX <= settled.x + settled.width &&
          dropY >= settled.y &&
          dropY <= settled.y + settled.height;
        if (stillInside) {
          await page.mouse.up();
          return;
        }
        continue;
      }
      // Nudge toward the target so auto-scroll brings it into the safe zone.
      const edge = to.y + to.height / 2 < viewport.height / 2 ? 80 : viewport.height - 80;
      await page.mouse.move(viewport.width / 2, edge, { steps: 6 });
    } else {
      await page.mouse.move(viewport.width / 2, viewport.height - 80, { steps: 6 });
    }
    await page.waitForTimeout(250);
  }
  await page.mouse.up();
}
