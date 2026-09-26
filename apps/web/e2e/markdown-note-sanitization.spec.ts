import { expect, test } from "@playwright/test";
import { openTaskSheet, signIn } from "./helpers";

const TASK = "Renew passport";

// The full malicious + safe payload corpus spec 20 requires the e2e spec to
// exercise: an event-handler payload, a script tag, a javascript: Markdown
// link, a heading and a safe link that must open hardened.
const PAYLOAD = [
  '<img src="x" onerror="alert(1)">',
  "<script>alert(1)</script>",
  "[x](javascript:alert(1))",
  "# Heading",
  "[Planora](https://example.com/docs)",
].join("\n\n");

test("previewing a malicious Markdown note neutralizes it and hardens safe links (spec 20, §8/§9)", async ({
  page,
}) => {
  let dialogSeen = false;
  page.on("dialog", () => {
    dialogSeen = true;
  });

  await signIn(page);
  const dialog = await openTaskSheet(page, TASK);

  await dialog.getByPlaceholder("# Notes").fill(PAYLOAD);
  await dialog.getByRole("tab", { name: "Preview" }).click();

  const preview = dialog.getByRole("tabpanel");
  await expect(preview.getByRole("heading", { level: 1, name: "Heading" })).toBeVisible();

  const safeLink = preview.getByRole("link", { name: "Planora" });
  await expect(safeLink).toBeVisible();
  await expect(safeLink).toHaveAttribute("target", "_blank");
  const rel = await safeLink.getAttribute("rel");
  expect(rel).toContain("noopener");
  expect(rel).toContain("noreferrer");

  // The `[x](javascript:alert(1))` link survives as text with its unsafe
  // href stripped, so it is no longer exposed with the "link" role at all.
  await expect(preview.getByRole("link", { name: "x", exact: true })).toHaveCount(0);
  await expect(preview.locator('[href*="javascript:" i]')).toHaveCount(0);
  await expect(preview.locator("script")).toHaveCount(0);
  await expect(preview.locator("[onerror]")).toHaveCount(0);

  expect(dialogSeen).toBe(false);
});
