import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { api } from "@/services/api";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const ReactModule = await import("react");
  return {
    Link: ({
      to,
      children,
      ...rest
    }: {
      to: string;
      children?: ReactNode;
      [key: string]: unknown;
    }) => ReactModule.createElement("a", { href: to, ...rest }, children),
    useNavigate: () => navigate,
  };
});

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: online });
}

let qc: QueryClient;

function renderShell() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(api, "getCurrentConversation").mockResolvedValue({ id: "c1", messages: [] });
  return render(
    <QueryClientProvider client={qc}>
      <AppShell>
        <p>board content</p>
      </AppShell>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  navigate.mockClear();
  setOnline(true);
  setViewportWidth(1024);
  qc?.clear();
});

describe("AppShell", () => {
  it("shows the offline banner only while the browser is offline", () => {
    setOnline(false);
    renderShell();

    expect(screen.getByText(/You're offline/)).toBeInTheDocument();
  });

  it("hides the offline banner while online", () => {
    setOnline(true);
    renderShell();

    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
  });

  it("opens the create task dialog from the header button", async () => {
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    expect(await screen.findByRole("heading", { name: "Add a task" })).toBeInTheDocument();
  });

  it("docks the AI Assistant panel open and closed on a desktop viewport", async () => {
    setViewportWidth(1280);
    renderShell();
    const toggle = screen.getByRole("button", { name: "AI Assistant" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const closeButton = await screen.findByRole("button", { name: "Close assistant" });

    fireEvent.click(closeButton);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Close assistant" })).not.toBeInTheDocument(),
    );
  });

  it("opens the mobile chat drawer instead of the docked panel below the desktop breakpoint", async () => {
    setViewportWidth(500);
    renderShell();

    fireEvent.click(screen.getByRole("button", { name: "AI Assistant" }));

    const closeButton = await screen.findByRole("button", { name: "Close assistant" });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // One close control only: the Sheet's built-in "Close" is not rendered (#81).
    expect(within(dialog).getAllByRole("button", { name: /close/i })).toHaveLength(1);

    fireEvent.click(closeButton);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("logs out through the account menu: clears cached queries and navigates to login", async () => {
    const logout = vi.spyOn(api, "logout").mockResolvedValue(undefined);
    renderShell();
    const clearSpy = vi.spyOn(qc, "clear");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Account menu" }), { button: 0 });
    fireEvent.click(await screen.findByText("Log out"));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });
});
