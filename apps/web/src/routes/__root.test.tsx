import { QueryClient } from "@tanstack/react-query";
import { render, screen, fireEvent } from "@testing-library/react";
import { createElement, StrictMode, type ComponentType, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invalidate = vi.fn();
const reportRootBoundaryError = vi.fn();
// Stands in for the real per-request client __root.tsx receives through
// route context; only its identity matters for these tests.
const routeQueryClient = new QueryClient();

vi.mock("@tanstack/react-router", async () => {
  const ReactModule = await import("react");
  return {
    createRootRouteWithContext: () => (options: unknown) => ({
      options,
      useRouteContext: () => ({ queryClient: routeQueryClient }),
    }),
    Outlet: () => ReactModule.createElement("div", { "data-testid": "outlet" }),
    Link: ({
      to,
      children,
      ...rest
    }: {
      to: string;
      children?: ReactNode;
      [key: string]: unknown;
    }) => ReactModule.createElement("a", { href: to, ...rest }, children),
    HeadContent: () => null,
    Scripts: () => null,
    useRouter: () => ({ invalidate }),
  };
});

vi.mock("@/lib/root-error-reporting", () => ({
  reportRootBoundaryError,
}));

afterEach(() => {
  vi.clearAllMocks();
});

// The real `createRootRouteWithContext<...>()({...})` return type is a deep
// generic that assumes the actual TanStack Router runtime; the mock above
// replaces that runtime with a plain `{ options, useRouteContext }` shape, so
// the test accesses it through this matching local type instead of the real
// (and here-inapplicable) ambient type.
type RootRouteOptions = {
  notFoundComponent: ComponentType<Record<string, never>>;
  errorComponent: ComponentType<{ error: unknown; reset: () => void }>;
  shellComponent: ComponentType<{ children: ReactNode }>;
  component: ComponentType<Record<string, never>>;
  head: () => { meta: Array<Record<string, string>> };
};

async function importRootRoute() {
  const mod = await import("@/routes/__root");
  return (mod as unknown as { Route: { options: RootRouteOptions } }).Route;
}

describe("root route", () => {
  it("shows a 404 message with a link back home", async () => {
    const Route = await importRootRoute();
    const NotFound = Route.options.notFoundComponent;
    render(createElement(NotFound, {}));

    expect(screen.getByRole("heading", { name: "404" })).toBeInTheDocument();
    expect(screen.getByText("Page not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  });

  it("shows the fallback and reports the error, and Try again re-invalidates the router", async () => {
    const Route = await importRootRoute();
    const ErrorFallback = Route.options.errorComponent;
    const reset = vi.fn();
    const error = new Error("boom");

    render(createElement(ErrorFallback, { error, reset }));
    expect(screen.getByRole("heading", { name: "This page didn't load" })).toBeInTheDocument();
    expect(reportRootBoundaryError).toHaveBeenCalledTimes(1);
    expect(reportRootBoundaryError).toHaveBeenCalledWith(error);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  });

  // React StrictMode intentionally double-invokes an Effect on mount (in
  // development) to surface exactly this class of bug: a side effect that
  // isn't idempotent. __root.tsx guards `reportRootBoundaryError` with a ref
  // check precisely so this double-invocation reports once, not twice. This
  // is the only way to actually exercise that guard: a plain re-render with
  // the same `error` reference never re-runs the effect at all (the
  // dependency array is unchanged), so it can't tell a present guard from a
  // deleted one.
  it("does not double-report the same error under a StrictMode double-invoked effect", async () => {
    const Route = await importRootRoute();
    const ErrorFallback = Route.options.errorComponent;
    const error = new Error("boom");

    render(
      createElement(StrictMode, null, createElement(ErrorFallback, { error, reset: vi.fn() })),
    );

    expect(reportRootBoundaryError).toHaveBeenCalledTimes(1);
  });

  it("reports a second, distinct error again", async () => {
    const Route = await importRootRoute();
    const ErrorFallback = Route.options.errorComponent;
    const first = new Error("boom");
    const second = new Error("boom again");

    const { rerender } = render(createElement(ErrorFallback, { error: first, reset: vi.fn() }));
    expect(reportRootBoundaryError).toHaveBeenCalledTimes(1);

    rerender(createElement(ErrorFallback, { error: second, reset: vi.fn() }));
    expect(reportRootBoundaryError).toHaveBeenCalledTimes(2);
    expect(reportRootBoundaryError).toHaveBeenLastCalledWith(second);
  });

  it("wraps children in the document shell", async () => {
    const Route = await importRootRoute();
    const Shell = Route.options.shellComponent;

    render(createElement(Shell, { children: createElement("p", null, "shell content") }));

    expect(screen.getByText("shell content")).toBeInTheDocument();
  });

  it("mounts the outlet inside the route's query client and exposes page metadata", async () => {
    const Route = await importRootRoute();
    const Root = Route.options.component;

    render(createElement(Root, {}));
    expect(screen.getByTestId("outlet")).toBeInTheDocument();

    expect(Route.options.head()).toMatchObject({
      meta: expect.arrayContaining([{ title: "Planora" }]),
    });
  });
});
