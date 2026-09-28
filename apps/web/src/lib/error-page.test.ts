import { describe, expect, it } from "vitest";
import { renderErrorPage } from "@/lib/error-page";

describe("renderErrorPage", () => {
  it("renders the generic fallback the user sees when the server can't recover", () => {
    const html = renderErrorPage();

    expect(html).toContain("This page didn't load");
    expect(html).toContain("Something went wrong on our end");
  });

  it("offers a way to retry and a way home, without any dynamic error detail", () => {
    const html = renderErrorPage();

    expect(html).toContain('onclick="location.reload()"');
    expect(html).toMatch(/<a class="secondary" href="\/">Go home<\/a>/);
    // the page is a static template: nothing it renders varies with the
    // triggering error, so there is nothing here that could leak a stack
    // trace or error message
    expect(html).not.toMatch(/error|stack|exception/i);
  });

  it("returns the same markup on every call", () => {
    expect(renderErrorPage()).toBe(renderErrorPage());
  });
});
