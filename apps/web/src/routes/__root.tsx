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

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
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
    <html lang="en">
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
      <Toaster richColors position="top-right" />
    </WorkspaceQueries>
  );
}
function WorkspaceQueries({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
function RootComponent() {
  return <ScopedContent />;
}
