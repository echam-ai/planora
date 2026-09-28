import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/index";
import { api } from "@/services/api";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useNavigate: () => navigate };
});

afterEach(() => {
  vi.restoreAllMocks();
  navigate.mockClear();
});

function renderIndex() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Route.options.component!),
    ),
  );
}

describe("Index route", () => {
  it("sends a signed-out visitor to login", async () => {
    vi.spyOn(api, "getSession").mockResolvedValue(null);
    renderIndex();

    await vi.waitUntil(() => navigate.mock.calls.length > 0);
    expect(navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });

  it("sends a signed-in visitor straight to the board", async () => {
    vi.spyOn(api, "getSession").mockResolvedValue({
      username: "demo",
      signedInAt: new Date().toISOString(),
    });
    renderIndex();

    await vi.waitUntil(() => navigate.mock.calls.length > 0);
    expect(navigate).toHaveBeenCalledWith({ to: "/tasks", replace: true });
  });

  it("waits for the session before navigating, showing a loading state", async () => {
    vi.spyOn(api, "getSession").mockReturnValue(new Promise(() => {}));
    renderIndex();

    expect(await screen.findByText("Loading your workspace…")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sets the landing page title", () => {
    expect(
      (Route.options.head as (() => { meta: Array<Record<string, string>> }) | undefined)?.(),
    ).toMatchObject({
      meta: expect.arrayContaining([{ title: "Planora — Your calm AI task board" }]),
    });
  });
});
