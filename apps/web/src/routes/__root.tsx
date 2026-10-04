import { getSelectedProfile, useSelectedProfile } from "@/services/api/profiles";
import { createQueryClient } from "@/lib/queryClient";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRoute,
  useRouter,
  HeadContent,
  Scripts,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportRootBoundaryError } from "../lib/root-error-reporting";
import { StatePanel } from "@/components/layout/StatePanel";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { refreshAccess, setAccessState, useAccessState } from "@/features/auth/access";
import { useTheme } from "@/lib/theme";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import { cn } from "@/lib/utils";
import { CloudOff, Compass, TriangleAlert } from "lucide-react";

function StatusPage({
  icon,
  title,
  children,
  actions,
  code,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  code?: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-pop">
        <span
          aria-hidden="true"
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
        >
          {icon}
        </span>
        {code ? (
          <h1 className="mt-5 text-6xl font-bold tracking-tight text-foreground">{code}</h1>
        ) : null}
        {code ? (
          <h2 className="mt-3 text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        ) : (
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        )}
        <p className="mt-2 text-sm text-muted-foreground">{children}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

function NotFoundComponent() {
  return (
    <StatusPage
      code="404"
      icon={<Compass className="size-6" />}
      title="Page not found"
      actions={
        <Link to="/" className={cn(buttonVariants(), "rounded-full px-5")}>
          Go home
        </Link>
      }
    >
      The page you're looking for doesn't exist or has been moved.
    </StatusPage>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();
  const reportedError = useRef<{ value: unknown } | null>(null);

  useEffect(() => {
    if (reportedError.current && Object.is(reportedError.current.value, error)) return;

    reportedError.current = { value: error };
    reportRootBoundaryError(error);
  }, [error]);

  return (
    <StatusPage
      icon={<TriangleAlert className="size-6" />}
      title="This page didn't load"
      actions={
        <>
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className={cn(buttonVariants(), "rounded-full px-5")}
          >
            Try again
          </button>
          <a href="/" className={cn(buttonVariants({ variant: "outline" }), "rounded-full px-5")}>
            Go home
          </a>
        </>
      }
    >
      Something went wrong on our end. You can try refreshing or head back home.
    </StatusPage>
  );
}

export const Route = createRootRoute({
  head: () => ({
    // Runs before first paint (see lib/theme-boot.ts), so it comes before the stylesheet.
    scripts: [{ children: THEME_BOOT_SCRIPT }],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Planora" },
      {
        name: "description",
        content:
          "Planora is a private task manager combining a Kanban board with an AI chat assistant for capturing, tracking, and completing tasks.",
      },
      { name: "author", content: "Planora" },
      { property: "og:title", content: "Planora" },
      {
        property: "og:description",
        content:
          "Planora is a private task manager combining a Kanban board with an AI chat assistant for capturing, tracking, and completing tasks.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // The inline theme script sets data-theme before React hydrates, so the attribute the server
    // rendered (none) legitimately differs from the DOM.
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function ScopedContent() {
  const profile = useSelectedProfile();
  const access = useAccessState();
  // Keep the SSR tree through the first browser snapshot so inputs typed
  // before hydration survive. Actual account changes still remount its cache.
  const [initialProfile] = useState(getSelectedProfile);
  const scopeKey =
    profile === undefined || profile === initialProfile ? "initial" : (profile ?? "chooser");
  // The path of the matches that are rendered right now. `useLocation` already holds the
  // destination while a navigation is pending, when the Outlet still renders the page being
  // left: gating on it would show that private page to a locked visitor for a moment.
  const pathname = useRouterState({
    select: (state) => (state.resolvedLocation ?? state.location).pathname,
  });
  const navigate = useNavigate();
  const isLogin = pathname === "/login";
  const publicRoute = pathname === "/" || isLogin;
  // The cookie is HttpOnly, so the API has to be asked. Until it answers, only the password page
  // renders: no private page, profile name or data appears before the answer (#124).
  useEffect(() => {
    if (access === "unknown") void refreshAccess();
  }, [access]);
  useEffect(() => {
    if (access === "locked" && !isLogin) navigate({ to: "/login", replace: true });
    if (access === "unlocked" && isLogin) navigate({ to: "/", replace: true });
  }, [access, isLogin, navigate]);
  useEffect(() => {
    if (access === "unlocked" && profile === null && !publicRoute)
      navigate({ to: "/", replace: true });
  }, [access, profile, publicRoute, navigate]);

  let page: ReactNode = null;
  if (isLogin) {
    if (access !== "unlocked") page = <Outlet />;
  } else if (access === "unlocked") {
    if (publicRoute || profile !== null) page = <Outlet />;
  } else if (access === "unreachable") {
    page = <AccessUnreachable />;
  }
  return (
    <WorkspaceQueries key={scopeKey}>
      {page}
      <Toaster position="top-right" />
    </WorkspaceQueries>
  );
}
function AccessUnreachable() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <StatePanel
        icon={CloudOff}
        tone="error"
        className="w-full max-w-sm"
        action={
          <Button variant="outline" onClick={() => void refreshAccess()}>
            Try again
          </Button>
        }
      >
        Can't reach Planora. Check your connection and try again.
      </StatePanel>
    </main>
  );
}
function WorkspaceQueries({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => {
    // A 401 from any query or mutation means the access cookie is gone: forget this account's
    // data and let the gate send the browser to /login (once; the state change is the trigger).
    const client: QueryClient = createQueryClient(() => {
      client.clear();
      setAccessState("locked");
    });
    return client;
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
/**
 * Keeps the theme live app-wide, including on the account chooser: `System` follows the OS
 * color scheme and another tab's choice arrives here. Subscribing also applies the stored
 * preference, which covers a page the inline head script never ran for.
 */
function ThemeSync() {
  useTheme();
  return null;
}
function RootComponent() {
  return (
    <>
      <ThemeSync />
      <ScopedContent />
    </>
  );
}
