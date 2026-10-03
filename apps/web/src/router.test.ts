import { describe, expect, it } from "vitest";
import { getRouter } from "@/router";

describe("getRouter", () => {
  it("builds no query client of its own; the app shell owns the only one", () => {
    expect(getRouter().options.context).toBeUndefined();
  });

  it("enables scroll restoration and always-fresh preloads", () => {
    const router = getRouter();

    expect(router.options.scrollRestoration).toBe(true);
    expect(router.options.defaultPreloadStaleTime).toBe(0);
  });
});
