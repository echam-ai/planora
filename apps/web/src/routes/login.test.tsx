import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/login";
import { api } from "@/services/api";

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

// No mock of `@/services/api/demoUi`: the default (unset VITE_API_MODE) is mock mode.
describe("Login route — mock mode", () => {
  it("shows the demo login hint", async () => {
    await renderLogin();

    expect(screen.getByText(/Demo login:/)).toHaveTextContent("Demo login: demo / focusboard");
  });
});
