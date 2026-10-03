import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/settings";
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

function renderSettings() {
  window.localStorage.setItem("planora.profile", "hamster_knight");
  vi.spyOn(api, "getSettings").mockResolvedValue({
    timezone: "UTC",
    modelName: "kimi-k3",
    availableModels: ["kimi-k3"],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Route.options.component!),
    ),
  );
  return screen.findByRole("combobox", { name: "Assistant model" });
}

afterEach(() => vi.restoreAllMocks());

describe("Settings route — HTTP mode", () => {
  it("hides the Demo data section and keeps the other sections", async () => {
    await renderSettings();

    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Change password" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Demo data" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Reset demo data/ })).not.toBeInTheDocument();
  });
});
