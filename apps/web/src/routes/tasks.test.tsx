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
  it("redirects an unauthenticated visit to login instead of loading the board", async () => {
    vi.spyOn(api, "getSession").mockResolvedValue(null);
    renderTasksRoute();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/login" }));
  });

  it("does not redirect once a session is present", async () => {
    vi.spyOn(api, "getSession").mockResolvedValue({
      username: "demo",
      signedInAt: new Date().toISOString(),
    });
    vi.spyOn(api, "getSettings").mockResolvedValue({
      timezone: "UTC",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    vi.spyOn(api, "listTasks").mockResolvedValue([]);
    renderTasksRoute();

    await screen.findByRole("heading", { name: "To do" });
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
