import type { Page } from "@playwright/test";

/**
 * Holds the mock adapter's simulated AI latency so a request stays pending for as long as a
 * test needs, instead of racing its random 600-1,400 ms delay.
 *
 * The mock's chat and parse calls wait on `setTimeout(…, 600..1400)`. Install this before the
 * first navigation. While `setHold(page, true)` is in effect, timers in that range are parked
 * (and counted by `heldCount`) instead of started; `releaseHeld` lets them run. Nothing in the
 * application is changed, and the mock still aborts on its own signal.
 */
type HoldWindow = {
  __aiHold: boolean;
  __aiHeld: Array<() => void>;
};

export async function holdMockAi(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as HoldWindow;
    w.__aiHold = false;
    w.__aiHeld = [];
    const realSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (w.__aiHold && typeof ms === "number" && ms >= 600 && ms <= 1400) {
        w.__aiHeld.push(() => {
          realSetTimeout(handler, 0, ...args);
        });
        return 0;
      }
      return realSetTimeout(handler, ms, ...args);
    }) as typeof window.setTimeout;
  });
}

export function setHold(page: Page, hold: boolean) {
  return page.evaluate((value) => {
    (window as unknown as HoldWindow).__aiHold = value;
  }, hold);
}

export function heldCount(page: Page) {
  return page.evaluate(() => (window as unknown as HoldWindow).__aiHeld.length);
}

export function releaseHeld(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as HoldWindow;
    for (const release of w.__aiHeld.splice(0)) release();
  });
}
