import { expect, test, type Page } from "@playwright/test";

import { expectHydrated } from "../e2e/hydration";
import { unlock } from "../e2e/unlock";
import { SITE_PASSWORD, llmOrigin, runSettings } from "./env";

/**
 * #123 against the real stack: browser, dev proxy, FastAPI and a loopback provider fixture that
 * answers only when released (`delayed-provider.ts`). Each spec cancels while the provider is
 * provably still working, then proves the cancel reached the provider (`aborted`) and that
 * nothing was saved. Texts are unique per run, so no test depends on another's rows.
 */
type ProviderCall = { id: number; capture: boolean; released: boolean; aborted: boolean };

const PROFILE = { "X-Planora-Profile": "hamster_knight" };
const uniqueText = (label: string) =>
  `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function providerCalls(page: Page): Promise<ProviderCall[]> {
  const response = await page.request.get(`${llmOrigin()}/control`);
  return (await response.json()) as ProviderCall[];
}

/** Waits for a provider call that is neither released nor cancelled. */
async function pendingCall(page: Page, capture: boolean): Promise<ProviderCall> {
  let found: ProviderCall | undefined;
  await expect
    .poll(async () => {
      found = (await providerCalls(page)).find(
        (c) => c.capture === capture && !c.released && !c.aborted,
      );
      return found !== undefined;
    })
    .toBe(true);
  return found!;
}

/** Waits until the API closed its connection to the provider: the cancel went all the way. */
async function expectProviderCancelled(page: Page, id: number) {
  await expect
    .poll(async () => (await providerCalls(page)).find((c) => c.id === id)?.aborted)
    .toBe(true);
}

async function release(page: Page, id: number) {
  const response = await page.request.post(`${llmOrigin()}/release/${id}`);
  expect(response.status()).toBe(200);
}

async function conversationTexts(page: Page, profile = PROFILE): Promise<string[]> {
  const response = await page.request.get("/api/v1/chat/conversation", { headers: profile });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { messages: { text: string }[] }).messages.map((m) => m.text);
}

const assistantToggle = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: "AI Assistant", exact: true });
const toasts = (page: Page) => page.locator("[data-sonner-toast]");
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;

async function openAssistant(page: Page) {
  if ((await assistantToggle(page).getAttribute("aria-pressed")) !== "true")
    await assistantToggle(page).click();
  return page.getByLabel("Message the assistant");
}

test.beforeEach(async ({ page }) => {
  await unlock(page, SITE_PASSWORD);
  await page.getByRole("button", { name: "Hamster Knight" }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
  // Start every spec from an empty conversation. The write needs the app's Origin (CSRF).
  const reset = await page.request.post("/api/v1/chat/conversation", {
    headers: { ...PROFILE, Origin: runSettings().webOrigin },
  });
  expect(reset.status()).toBe(201);
});

test("a cancelled chat send saves nothing, even after a reload, and the next send works", async ({
  page,
}) => {
  const cancelled = uniqueText("Cancelled chat");
  const input = await openAssistant(page);
  await input.fill(cancelled);
  await input.press("Enter");
  await expect(page.getByText("Thinking…", { exact: true })).toBeVisible();
  const first = await pendingCall(page, false);

  await page.getByRole("button", { name: "Cancel request", exact: true }).click();

  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(input).toHaveValue(cancelled);
  await expect(page.getByText("The assistant didn't respond.")).toHaveCount(0);
  await expect(toasts(page)).toHaveCount(0);
  await expectProviderCancelled(page, first.id);
  expect(await conversationTexts(page)).toEqual([]);

  // Even a late provider answer cannot resurrect it.
  await release(page, first.id);
  expect(await conversationTexts(page)).toEqual([]);
  await page.reload();
  await expectHydrated(page, 'button[aria-label="AI Assistant"]');
  await openAssistant(page);
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText(cancelled)).toHaveCount(0);
  await expect(page.getByText(`Fixture chat ${first.id}`)).toHaveCount(0);

  const followUp = uniqueText("List my high-priority tasks");
  await page.getByLabel("Message the assistant").fill(followUp);
  await page.getByLabel("Message the assistant").press("Enter");
  const second = await pendingCall(page, false);
  expect(second.id).not.toBe(first.id);
  await release(page, second.id);

  await expect(page.getByText(`Fixture chat ${second.id}`, { exact: true })).toBeVisible();
  await expect(page.getByText(followUp, { exact: true })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  expect(await conversationTexts(page)).toEqual([followUp, `Fixture chat ${second.id}`]);
});

test("closing the assistant while it is thinking cancels the request and saves nothing", async ({
  page,
}) => {
  const text = uniqueText("Closed chat");
  const input = await openAssistant(page);
  await input.fill(text);
  await input.press("Enter");
  const call = await pendingCall(page, false);

  if (isMobile(page)) await page.keyboard.press("Escape");
  else await page.getByRole("button", { name: "Close assistant", exact: true }).click();
  await expect(input).toHaveCount(0);

  await expectProviderCancelled(page, call.id);
  expect(await conversationTexts(page)).toEqual([]);
  await release(page, call.id);
  await openAssistant(page);
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Thinking…", { exact: true })).toHaveCount(0);
  await expect(page.getByText(text)).toHaveCount(0);
});

test("switching account while the assistant is thinking cancels it for both profiles", async ({
  page,
}) => {
  // The mobile drawer is modal, so the account menu cannot be reached while a send is pending.
  test.skip(isMobile(page), "the modal drawer covers the account menu");
  const text = uniqueText("Switch account chat");
  const input = await openAssistant(page);
  await input.fill(text);
  await input.press("Enter");
  const call = await pendingCall(page, false);

  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Switch account" }).click();
  await page.getByRole("button", { name: "Ech Princess", exact: true }).click();
  await expect(page.getByLabel("Selected account")).toHaveText("Ech Princess");

  await expectProviderCancelled(page, call.id);
  await release(page, call.id);
  await openAssistant(page);
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Thinking…", { exact: true })).toHaveCount(0);
  await expect(page.getByText(text)).toHaveCount(0);
  await expect(page.getByText(`Fixture chat ${call.id}`)).toHaveCount(0);
  expect(await conversationTexts(page, { "X-Planora-Profile": "ech_princess" })).toEqual([]);
  expect(await conversationTexts(page)).toEqual([]);
});

test.describe("quick capture", () => {
  const dialog = (page: Page) => page.getByRole("dialog", { name: "Add a task" });
  const note = (page: Page) => dialog(page).getByLabel("Describe the task in your own words");

  async function startParsing(page: Page, text: string) {
    await page.getByRole("button", { name: "Add task" }).click();
    await note(page).fill(text);
    await dialog(page).getByRole("button", { name: "Parse task" }).click();
    await expect(dialog(page).getByRole("button", { name: "Reading your note…" })).toBeDisabled();
    return pendingCall(page, true);
  }

  test("Stop parsing cancels the request; its late result never opens the review", async ({
    page,
  }) => {
    const text = uniqueText("Stopped capture");
    const first = await startParsing(page, text);

    await dialog(page).getByRole("button", { name: "Stop parsing", exact: true }).click();

    await expect(dialog(page)).toBeVisible();
    await expect(note(page)).toHaveValue(text);
    await expect(note(page)).toBeFocused();
    await expect(dialog(page).getByRole("button", { name: "Parse task" })).toBeEnabled();
    await expectProviderCancelled(page, first.id);
    await release(page, first.id);
    await expect(dialog(page).getByLabel("Title")).toHaveCount(0);

    await dialog(page).getByRole("button", { name: "Parse task" }).click();
    const second = await pendingCall(page, true);
    await release(page, second.id);
    await expect(dialog(page).getByLabel("Title")).toHaveValue(`Fixture capture ${second.id}`);
  });

  test("Escape while parsing cancels it; reopening shows an empty Quick capture", async ({
    page,
  }) => {
    const call = await startParsing(page, uniqueText("Closed capture"));

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expectProviderCancelled(page, call.id);
    await release(page, call.id);

    await page.getByRole("button", { name: "Add task" }).click();
    await expect(note(page)).toHaveValue("");
    await expect(dialog(page).getByRole("button", { name: "Parse task" })).toBeDisabled();
    await expect(dialog(page).getByLabel("Title")).toHaveCount(0);
  });
});
