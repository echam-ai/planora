import { getSelectedProfile, useSelectedProfile } from "@/services/api/profiles";
import { createQueryClient } from "@/lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRoute,
  useRouter,
  HeadContent,
  Scripts,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportRootBoundaryError } from "../lib/root-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { buttonVariants } from "@/components/ui/button-variants";
import { useTheme } from "@/lib/theme";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import { cn } from "@/lib/utils";
import { Compass, TriangleAlert } from "lucide-react";

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
  // Keep the SSR tree through the first browser snapshot so inputs typed
  // before hydration survive. Actual account changes still remount its cache.
  const [initialProfile] = useState(getSelectedProfile);
  const scopeKey =
    profile === undefined || profile === initialProfile ? "initial" : (profile ?? "chooser");
  const location = useLocation();
  const navigate = useNavigate();
  const publicRoute = location.pathname === "/" || location.pathname === "/login";
  useEffect(() => {
    if (profile === null && !publicRoute) navigate({ to: "/", replace: true });
  }, [profile, publicRoute, navigate]);
  return (
    <WorkspaceQueries key={scopeKey}>
      {(publicRoute || profile !== null) && <Outlet />}
      <Toaster position="top-right" />
    </WorkspaceQueries>
  );
}
function WorkspaceQueries({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
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
