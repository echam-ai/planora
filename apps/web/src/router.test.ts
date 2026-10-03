import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { getRouter } from "@/router";

describe("getRouter", () => {
  it("wires a fresh query client into the router context", () => {
    const router = getRouter();

    expect(router.options.context?.queryClient).toBeInstanceOf(QueryClient);
  });

  it("gives every call its own query client, so requests never share cached state", () => {
    const first = getRouter();
    const second = getRouter();

    expect(first.options.context?.queryClient).not.toBe(second.options.context?.queryClient);
  });

  it("enables scroll restoration and always-fresh preloads", () => {
    const router = getRouter();

    expect(router.options.scrollRestoration).toBe(true);
    expect(router.options.defaultPreloadStaleTime).toBe(0);
  });
});
