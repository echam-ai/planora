import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/login";
import { api } from "@/services/api";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("@/hooks/useApi", () => ({
  useSession: () => ({ data: null }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  navigate.mockClear();
});

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Route.options.component!),
    ),
  );
}

describe("LoginPage", () => {
  it("shows required messages and does not call the API for blank credentials", async () => {
    const login = vi.spyOn(api, "login");
    renderLogin();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter your username")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("passes credential spaces to the API unchanged", async () => {
    const login = vi
      .spyOn(api, "login")
      .mockResolvedValue({ username: "demo", signedInAt: "2026-09-23T00:00:00.000Z" });
    renderLogin();

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: " demo " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: " pass " } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith(" demo ", " pass "));
  });

  it("keeps an API rejection visible", async () => {
    vi.spyOn(api, "login").mockRejectedValue(new Error("That username or password isn't right."));
    renderLogin();

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "demo" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That username or password isn't right.",
    );
  });
});
