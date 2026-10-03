import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { selectProfile } from "@/services/api/profiles";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createElement, StrictMode, type ComponentType, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import { THEME_KEY } from "@/lib/theme";

const profileContext = vi.hoisted(() => ({
  pathname: "/",
  navigate: vi.fn(),
  cache: null as unknown,
}));
const invalidate = vi.fn();
const reportRootBoundaryError = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const ReactModule = await import("react");
  const QueryModule = await import("@tanstack/react-query");
  return {
    createRootRoute: (options: unknown) => ({ options }),
    Outlet: function MockOutlet() {
      profileContext.cache = QueryModule.useQueryClient();
      return ReactModule.createElement(
        "div",
        { "data-testid": "outlet" },
        ReactModule.createElement("input", { "aria-label": "Draft search", defaultValue: "" }),
      );
    },
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
    useLocation: () => ({ pathname: profileContext.pathname }),
    useNavigate: () => profileContext.navigate,
    useRouter: () => ({ invalidate }),
  };
});

vi.mock("@/lib/root-error-reporting", () => ({
  reportRootBoundaryError,
}));

afterEach(() => {
  vi.clearAllMocks();
  profileContext.pathname = "/";
});

// The real `createRootRoute({...})` return type is a deep
// generic that assumes the actual TanStack Router runtime; the mock above
// replaces that runtime with a plain `{ options }` shape, so
// the test accesses it through this matching local type instead of the real
// (and here-inapplicable) ambient type.
type RootRouteOptions = {
  notFoundComponent: ComponentType<Record<string, never>>;
  errorComponent: ComponentType<{ error: unknown; reset: () => void }>;
  shellComponent: ComponentType<{ children: ReactNode }>;
  component: ComponentType<Record<string, never>>;
  head: () => {
    meta: Array<Record<string, string>>;
    scripts?: Array<{ children?: string }>;
    links?: Array<{ rel: string; href: string }>;
  };
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

describe("theme bootstrap", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(THEME_KEY);
  });

  it("puts the inline theme script in the head, ahead of the stylesheet", async () => {
    const Route = await importRootRoute();
    const head = Route.options.head();
    expect(head.scripts).toEqual([{ children: THEME_BOOT_SCRIPT }]);
  });

  it("applies the stored theme itself if the inline script never ran", async () => {
    localStorage.setItem(THEME_KEY, "colorful");
    const Route = await importRootRoute();
    const Root = Route.options.component;
    render(createElement(Root, {}));
    expect(document.documentElement.dataset["theme"]).toBe("colorful");
  });
});

it("gates missing selection and remounts query caches on profile switch", async () => {
  profileContext.pathname = "/tasks";
  selectProfile(null);
  const Route = await importRootRoute();
  const Root = Route.options.component;
  render(createElement(Root, {}));
  expect(screen.queryByTestId("outlet")).toBeNull();
  expect(profileContext.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  act(() => selectProfile("hamster_knight"));
  expect(screen.getByTestId("outlet")).toBeInTheDocument();
  const oldCache = profileContext.cache as QueryClient;
  oldCache.setQueryData(["tasks"], ["Knight only"]);
  act(() => selectProfile("ech_princess"));
  const newCache = profileContext.cache as QueryClient;
  expect(newCache).not.toBe(oldCache);
  expect(newCache.getQueryData(["tasks"])).toBeUndefined();
});

it("hydrates a remembered private route without redirecting or replacing its typed input", async () => {
  profileContext.pathname = "/tasks";
  selectProfile("hamster_knight");
  const Route = await importRootRoute();
  const Root = Route.options.component;
  const container = document.createElement("div");
  container.innerHTML = renderToString(createElement(Root, {}));
  document.body.append(container);
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Draft search"]');
  expect(input).not.toBeNull();
  input!.value = "Typed before hydration";
  const htmlRoot = hydrateRoot(container, createElement(Root, {}));
  try {
    await act(async () => {});
    expect(profileContext.navigate).not.toHaveBeenCalled();
    expect(container.querySelector('input[aria-label="Draft search"]')).toBe(input);
    expect(input).toHaveValue("Typed before hydration");
  } finally {
    await act(async () => htmlRoot.unmount());
    container.remove();
  }
});
