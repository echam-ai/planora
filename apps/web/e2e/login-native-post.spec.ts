import { expect, test } from "@playwright/test";

import { expectHydrated, holdScripts } from "./hydration";

const USERNAME = "native-user-114";
const PASSWORD = "native-password-114";

test("native login POST discards credentials and returns to a working sign-in", async ({
  page,
  context,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const release = await holdScripts(page);

  await page.goto("/login", { waitUntil: "commit" });
  const form = page.locator("form");
  await expect(form).toHaveAttribute("method", "post");
  await expect(form).toHaveAttribute("action", "/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeDisabled();
  await page.getByLabel("Username").fill(USERNAME);
  await page.getByLabel("Password").fill(PASSWORD);

  const postResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/login",
  );
  await form.evaluate((element: HTMLFormElement) => element.submit());
  const postResponse = await postResponsePromise;

  expect(postResponse.status()).toBe(303);
  expect(postResponse.headers()["location"]).toBe("/login");
  expect(postResponse.headers()["cache-control"]).toBe("no-store");
  await expect(page).toHaveURL(/\/login$/);
  expect(new URL(page.url()).search).toBe("");
  const redirectedHtml = await page.content();
  expect(redirectedHtml).not.toContain(USERNAME);
  expect(redirectedHtml).not.toContain(PASSWORD);
  expect(requests.some((url) => url.includes("/api/v1/auth/login"))).toBe(false);
  for (const url of [
    ...requests,
    page.url(),
    postResponse.url(),
    postResponse.headers()["location"],
  ]) {
    expect(url).not.toContain(USERNAME);
    expect(url).not.toContain(PASSWORD);
  }
  expect(await page.evaluate(() => localStorage.getItem("planora.session"))).toBeNull();
  expect(await context.cookies()).toEqual([]);

  release();
  await expectHydrated(page, "#username");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  await page.getByLabel("Username").fill("demo");
  await page.getByLabel("Password").fill("focusboard");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "To do" })).toBeVisible();
});
