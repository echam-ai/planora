import { isRedirect } from "@tanstack/react-router";
import { expect, it } from "vitest";
import { Route } from "./login";
it("redirects former login links before rendering or client hydration", () => {
  expect(Route.options.beforeLoad).toBeTypeOf("function");
  let result: unknown;
  try {
    Route.options.beforeLoad!({} as never);
  } catch (error) {
    result = error;
  }
  expect(isRedirect(result)).toBe(true);
  expect(result).toMatchObject({ options: { to: "/", replace: true } });
});
