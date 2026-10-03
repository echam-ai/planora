import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/settings";
import { api } from "@/services/api";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }));

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

// No mock of `@/services/api/demoUi`: the default (unset VITE_API_MODE) is mock mode.
describe("Settings route — demo data in mock mode", () => {
  it("resets demo data after confirmation", async () => {
    await renderSettings();
    const reset = vi.spyOn(api, "resetDemoData").mockResolvedValue(undefined);

    expect(screen.getByRole("heading", { name: "Demo data" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reset demo data/ }));
    expect(await screen.findByText("Reset demo data?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Demo data reset"));
  });
});
