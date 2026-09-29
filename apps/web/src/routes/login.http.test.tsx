import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/login";
import { api } from "@/services/api";

// Stands in for a `VITE_API_MODE=http` build. The build grep proves the real
// constant is folded away; this proves the page honours it.
vi.mock("@/services/api/demoUi", () => ({ DEMO_UI_ENABLED: false }));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  const ReactModule = await import("react");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode; [k: string]: unknown }) =>
      ReactModule.createElement("a", { href: to, ...rest }, children),
  };
});

async function renderLogin() {
  vi.spyOn(api, "getSession").mockResolvedValue(null);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Route.options.component!),
    ),
  );
  await screen.findByRole("button", { name: "Sign in" });
}

afterEach(() => vi.restoreAllMocks());

describe("Login route — HTTP mode", () => {
  it("shows no demo credential", async () => {
    await renderLogin();

    expect(screen.queryByText(/Demo login|focusboard/)).not.toBeInTheDocument();
  });
});
