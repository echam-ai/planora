import { expect, test } from "@playwright/test";
test("retired login POST redirects to account choice without a session", async ({
  page,
  context,
}) => {
  const response = await page.request.post("/login", {
    form: { username: "retired", password: "retired" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(response.headers()["location"]).toBe("/");
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Hamster Knight" })).toBeVisible();
  expect(await context.cookies()).toEqual([]);
});
