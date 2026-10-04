import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { selectProfile } from "@/services/api/profiles";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { createElement, StrictMode, type ComponentType, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import { THEME_KEY } from "@/lib/theme";
import { api } from "@/services/api";
import { getAccessState, resetAccessState, setAccessState } from "@/features/auth/access";
import { ApiError } from "@/types";

const profileContext = vi.hoisted(() => ({
  pathname: "/",
  /** The path of the rendered matches; defaults to `pathname`, differs while a navigation is pending. */
  resolved: undefined as string | undefined,
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
    useRouterState: ({
      select,
    }: {
      select: (state: {
        location: { pathname: string };
        resolvedLocation?: { pathname: string };
      }) => unknown;
    }) =>
      select({
        location: { pathname: profileContext.pathname },
        ...(profileContext.resolved
          ? { resolvedLocation: { pathname: profileContext.resolved } }
          : {}),
      }),
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
  profileContext.resolved = undefined;
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
    expect(await screen.findByTestId("outlet")).toBeInTheDocument();

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
  await waitFor(() =>
    expect(profileContext.navigate).toHaveBeenCalledWith({ to: "/", replace: true }),
  );
  expect(screen.queryByTestId("outlet")).toBeNull();
  act(() => selectProfile("hamster_knight"));
  expect(screen.getByTestId("outlet")).toBeInTheDocument();
  const oldCache = profileContext.cache as QueryClient;
  oldCache.setQueryData(["tasks"], ["Knight only"]);
  act(() => selectProfile("ech_princess"));
  // Access is kept across the switch: the page never goes blank while it is asked again.
  expect(screen.getByTestId("outlet")).toBeInTheDocument();
  const newCache = profileContext.cache as QueryClient;
  expect(newCache).not.toBe(oldCache);
  expect(newCache.getQueryData(["tasks"])).toBeUndefined();
});

it("hydrates the password page without redirecting or replacing a password typed before hydration", async () => {
  profileContext.pathname = "/login";
  vi.spyOn(api, "getAccess").mockResolvedValue({ authenticated: false });
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
    expect(getAccessState()).toBe("locked");
    expect(profileContext.navigate).not.toHaveBeenCalled();
    expect(container.querySelector('input[aria-label="Draft search"]')).toBe(input);
    expect(input).toHaveValue("Typed before hydration");
  } finally {
    await act(async () => htmlRoot.unmount());
    container.remove();
  }
});

describe("access gate (#124)", () => {
  async function mountRoot(pathname: string) {
    profileContext.pathname = pathname;
    const Route = await importRootRoute();
    const Root = Route.options.component;
    return render(createElement(Root, {}));
  }

  afterEach(() => vi.restoreAllMocks());

  it("renders nothing on a private route until the API has answered, and not on the server", async () => {
    let answer!: (value: { authenticated: boolean }) => void;
    vi.spyOn(api, "getAccess").mockReturnValue(new Promise((resolve) => (answer = resolve)));
    profileContext.pathname = "/tasks";
    const Route = await importRootRoute();
    expect(renderToString(createElement(Route.options.component, {}))).not.toContain("outlet");
    await mountRoot("/tasks");
    expect(screen.queryByTestId("outlet")).toBeNull();
    expect(profileContext.navigate).not.toHaveBeenCalled();
    await act(async () => answer({ authenticated: true }));
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  it.each(["/", "/tasks", "/archive", "/settings"])(
    "sends a locked visit to %s to /login without rendering it",
    async (path) => {
      vi.spyOn(api, "getAccess").mockResolvedValue({ authenticated: false });
      await mountRoot(path);
      await waitFor(() =>
        expect(profileContext.navigate).toHaveBeenCalledWith({ to: "/login", replace: true }),
      );
      expect(profileContext.navigate).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId("outlet")).toBeNull();
    },
  );

  it("gates on the page that is rendered, not on the destination of a pending navigation", async () => {
    vi.spyOn(api, "getAccess").mockResolvedValue({ authenticated: false });
    // Locked, heading to /login, but the Outlet still holds the private page it is leaving.
    profileContext.resolved = "/tasks";
    await mountRoot("/login");
    await waitFor(() => expect(getAccessState()).toBe("locked"));
    expect(screen.queryByTestId("outlet")).toBeNull();
    // The password page is what renders once the navigation has resolved.
    profileContext.resolved = "/login";
    act(() => setAccessState("unknown"));
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  it("keeps showing the password page to a locked visitor", async () => {
    vi.spyOn(api, "getAccess").mockResolvedValue({ authenticated: false });
    await mountRoot("/login");
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    await waitFor(() => expect(getAccessState()).toBe("locked"));
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(profileContext.navigate).not.toHaveBeenCalled();
  });

  it("sends an unlocked visit to /login to the chooser", async () => {
    await mountRoot("/login");
    await waitFor(() =>
      expect(profileContext.navigate).toHaveBeenCalledWith({ to: "/", replace: true }),
    );
    expect(screen.queryByTestId("outlet")).toBeNull();
  });

  it("shows the chooser to an unlocked visitor who has not chosen an account", async () => {
    selectProfile(null);
    await mountRoot("/");
    expect(await screen.findByTestId("outlet")).toBeInTheDocument();
    expect(profileContext.navigate).not.toHaveBeenCalled();
  });

  it("offers a retry when the API cannot be reached", async () => {
    const getAccess = vi
      .spyOn(api, "getAccess")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ authenticated: true });
    await mountRoot("/tasks");
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach Planora");
    expect(screen.queryByTestId("outlet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("outlet")).toBeInTheDocument();
    expect(getAccess).toHaveBeenCalledTimes(2);
  });

  it("still shows the password page when the API cannot be reached", async () => {
    vi.spyOn(api, "getAccess").mockRejectedValue(new Error("offline"));
    await mountRoot("/login");
    await waitFor(() => expect(getAccessState()).toBe("unreachable"));
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  describe("an expired session", () => {
    const expired = () =>
      new ApiError("NOT_AUTHENTICATED", "Authentication is required.", { status: 401 });

    it("clears the cache and goes to /login once, however many requests fail", async () => {
      await mountRoot("/tasks");
      await screen.findByTestId("outlet");
      const cache = profileContext.cache as QueryClient;
      cache.setQueryData(["tasks"], ["Knight only"]);

      await act(async () => {
        await Promise.allSettled([
          cache.fetchQuery({ queryKey: ["a"], queryFn: () => Promise.reject(expired()) }),
          cache.fetchQuery({ queryKey: ["b"], queryFn: () => Promise.reject(expired()) }),
        ]);
      });

      expect(getAccessState()).toBe("locked");
      expect(cache.getQueryData(["tasks"])).toBeUndefined();
      expect(profileContext.navigate).toHaveBeenCalledTimes(1);
      expect(profileContext.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
      expect(screen.queryByTestId("outlet")).toBeNull();
    });

    it("also reacts to a failed mutation", async () => {
      await mountRoot("/tasks");
      await screen.findByTestId("outlet");
      const cache = profileContext.cache as QueryClient;
      await act(async () => {
        await cache
          .getMutationCache()
          .build(cache, { mutationFn: () => Promise.reject(expired()) })
          .execute(undefined)
          .catch(() => {});
      });
      expect(profileContext.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
    });

    it("does not treat a wrong password as an expired session", async () => {
      await mountRoot("/tasks");
      await screen.findByTestId("outlet");
      const cache = profileContext.cache as QueryClient;
      await act(async () => {
        await cache
          .fetchQuery({
            queryKey: ["unlock"],
            retry: false,
            queryFn: () =>
              Promise.reject(
                new ApiError("INVALID_PASSWORD", "Incorrect password.", { status: 401 }),
              ),
          })
          .catch(() => {});
      });
      expect(getAccessState()).toBe("unlocked");
      expect(profileContext.navigate).not.toHaveBeenCalled();
      expect(screen.getByTestId("outlet")).toBeInTheDocument();
    });

    it("does not loop: the password page it lands on makes no gated request", async () => {
      await mountRoot("/tasks");
      await screen.findByTestId("outlet");
      act(() => setAccessState("locked"));
      expect(profileContext.navigate).toHaveBeenCalledTimes(1);
      profileContext.navigate.mockClear();
      profileContext.pathname = "/login";
      resetAccessState();
      act(() => setAccessState("locked"));
      expect(profileContext.navigate).not.toHaveBeenCalled();
    });
  });
});
