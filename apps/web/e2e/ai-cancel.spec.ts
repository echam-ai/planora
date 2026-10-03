import { expect, test, type Page } from "@playwright/test";
import { heldCount, holdMockAi, releaseHeld, setHold } from "./ai-hold";
import { signIn } from "./helpers";

/**
 * #123: AI requests can be cancelled. The mock's latency is held (see `ai-hold.ts`) so each
 * request is provably pending while the test acts; nothing here races a random delay.
 */
const assistantToggle = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: "AI Assistant", exact: true });
const toasts = (page: Page) => page.locator("[data-sonner-toast]");

async function openAssistant(page: Page) {
  await assistantToggle(page).click();
  return page.getByLabel("Message the assistant");
}

/** Sends `text` and returns once the mock has the request parked. */
async function sendHeld(page: Page, text: string) {
  const input = page.getByLabel("Message the assistant");
  await input.fill(text);
  await setHold(page, true);
  await input.press("Enter");
  await expect(page.getByText("Thinking…", { exact: true })).toBeVisible();
  await expect.poll(() => heldCount(page)).toBe(1);
  await setHold(page, false);
}

const storedMessages = (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem("planora.hamster_knight.conversation");
    return raw ? (JSON.parse(raw) as { messages: unknown[] }).messages.length : 0;
  });

test.beforeEach(async ({ page }) => {
  await holdMockAi(page);
  await signIn(page);
});

test("Cancel request stops a pending chat message, keeps its text and lets the next one through", async ({
  page,
}) => {
  const input = await openAssistant(page);
  await sendHeld(page, "What is overdue?");
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(0);

  // Reachable from the message input with Tab, activated with the keyboard.
  await input.press("Tab");
  const cancel = page.getByRole("button", { name: "Cancel request", exact: true });
  await expect(cancel).toBeFocused();
  await cancel.press("Enter");

  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Thinking…", { exact: true })).toHaveCount(0);
  await expect(cancel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await expect(input).toHaveValue("What is overdue?");
  await expect(input).toBeFocused();
  await expect(page.getByText("The assistant didn't respond.")).toHaveCount(0);
  await expect(toasts(page)).toHaveCount(0);

  // Even if the held request were to finish now, nothing from it reaches the panel or storage.
  await releaseHeld(page);
  await expect(page.getByText(/overdue task|Nothing is overdue/)).toHaveCount(0);
  expect(await storedMessages(page)).toBe(0);

  await input.fill("List my high-priority tasks");
  await input.press("Enter");
  await expect(page.getByText("List my high-priority tasks", { exact: true })).toBeVisible();
  await expect(page.getByText(/Found \d+ matching tasks?/)).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  expect(await storedMessages(page)).toBe(2);
});

test("Cancel request with the mouse keeps text typed in the meantime", async ({ page }) => {
  const input = await openAssistant(page);
  await sendHeld(page, "What is overdue?");
  await input.fill("draft");

  await page.getByRole("button", { name: "Cancel request", exact: true }).click();

  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("draft");
});

test("closing the assistant while it is thinking aborts the request", async ({ page }) => {
  const input = await openAssistant(page);
  await sendHeld(page, "What is overdue?");
  const mobile = (page.viewportSize()?.width ?? 0) < 1024;

  if (mobile) {
    // The mobile drawer is a modal dialog: Escape dismisses it.
    await page.keyboard.press("Escape");
  } else {
    await page.getByRole("button", { name: "Close assistant", exact: true }).click();
  }
  await expect(input).toHaveCount(0);

  await releaseHeld(page);
  await assistantToggle(page).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Thinking…", { exact: true })).toHaveCount(0);
  // The conversation is still empty: the welcome state (with its suggestions) is showing.
  await expect(page.getByText(/I never change anything without your confirmation/)).toBeVisible();
  expect(await storedMessages(page)).toBe(0);
});

test.describe("quick capture", () => {
  const dialog = (page: Page) => page.getByRole("dialog", { name: "Add a task" });
  const note = (page: Page) => dialog(page).getByLabel("Describe the task in your own words");

  async function parseHeld(page: Page) {
    await page.getByRole("button", { name: "Add task" }).click();
    await note(page).fill("Prepare the quarterly review by Friday");
    await setHold(page, true);
    await dialog(page).getByRole("button", { name: "Parse task" }).click();
    await expect(dialog(page).getByRole("button", { name: "Reading your note…" })).toBeDisabled();
    await expect.poll(() => heldCount(page)).toBe(1);
    await setHold(page, false);
  }

  test("Stop parsing keeps the dialog and the note, and a late result opens nothing", async ({
    page,
  }) => {
    await parseHeld(page);
    await expect(dialog(page).getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);

    await dialog(page).getByRole("button", { name: "Stop parsing", exact: true }).click();

    await expect(dialog(page)).toBeVisible();
    await expect(note(page)).toHaveValue("Prepare the quarterly review by Friday");
    await expect(note(page)).toBeFocused();
    await expect(dialog(page).getByRole("button", { name: "Parse task" })).toBeEnabled();
    await expect(dialog(page).getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await expect(toasts(page)).toHaveCount(0);
    await expect(dialog(page).getByText("Continue in the form instead")).toHaveCount(0);

    await releaseHeld(page);
    await expect(dialog(page).getByLabel("Title")).toHaveCount(0);

    await dialog(page).getByRole("button", { name: "Parse task" }).click();
    await expect(dialog(page).getByLabel("Title")).toHaveValue(/Prepare the quarterly review/);
  });

  test("Escape while parsing closes the dialog; reopening starts empty", async ({ page }) => {
    await parseHeld(page);

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await releaseHeld(page);

    await page.getByRole("button", { name: "Add task" }).click();
    await expect(note(page)).toHaveValue("");
    await expect(dialog(page).getByRole("button", { name: "Parse task" })).toBeDisabled();
    await expect(dialog(page).getByLabel("Title")).toHaveCount(0);
  });
});
