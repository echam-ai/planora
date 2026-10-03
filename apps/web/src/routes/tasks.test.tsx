import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/tasks";
import { api } from "@/services/api";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  const ReactModule = await import("react");
  return {
    ...actual,
    useNavigate: () => navigate,
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode; [k: string]: unknown }) =>
      ReactModule.createElement("a", { href: to, ...rest }, children),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  navigate.mockClear();
});

function renderTasksRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Route.options.component!),
    ),
  );
}

describe("TasksPage route", () => {
  it("redirects a visit without a profile to the chooser", async () => {
    window.localStorage.removeItem("planora.profile");
    renderTasksRoute();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true }));
  });

  it("does not redirect once a profile is selected", async () => {
    window.localStorage.setItem("planora.profile", "hamster_knight");
    vi.spyOn(api, "getSettings").mockResolvedValue({
      timezone: "UTC",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    vi.spyOn(api, "listTasks").mockResolvedValue([]);
    renderTasksRoute();

    // The column heading (an h2) appears only once the session, settings and task queries
    // settle. A text query with the h2 selector avoids the role query's whole-tree style
    // recomputation, which is what pushed this wait past the 1 s default under CPU load.
    await screen.findByText("To do", { selector: "h2" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sets the active-tasks page title", () => {
    expect(
      (Route.options.head as (() => { meta: Array<Record<string, string>> }) | undefined)?.(),
    ).toMatchObject({
      meta: expect.arrayContaining([{ title: "Active tasks — Planora" }]),
    });
  });
});
