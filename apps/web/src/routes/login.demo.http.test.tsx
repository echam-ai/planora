import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/login";

// Stands in for a `VITE_API_MODE=http` build. The build grep proves the real constant (and the
// mock's password) is folded out of the bundle; this proves the page honours the constant.
vi.mock("@/services/api/demoUi", () => ({ DEMO_UI_ENABLED: false }));

vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual("@tanstack/react-router")),
  useNavigate: () => vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

describe("Password page — HTTP mode", () => {
  it("shows the form but no demo password", () => {
    render(createElement(Route.options.component!));

    expect(screen.getByLabelText("Password")).toBeVisible();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeVisible();
    expect(screen.queryByText("focusboard")).not.toBeInTheDocument();
    expect(screen.queryByText(/demo password/i)).not.toBeInTheDocument();
  });
});
