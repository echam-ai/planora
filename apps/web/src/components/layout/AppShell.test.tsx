import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { api } from "@/services/api";
import { getAccessState, resetAccessState, setAccessState } from "@/features/auth/access";
import { THEME_KEY } from "@/lib/theme";

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
  window.localStorage.removeItem(THEME_KEY);
  document.documentElement.removeAttribute("data-theme");
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

  it("keeps the named header actions available and opens task capture at 320px", async () => {
    setViewportWidth(320);
    renderShell();

    const header = within(screen.getByRole("banner"));
    for (const name of ["Add task", "AI Assistant", "Account menu"]) {
      expect(header.getByRole("button", { name })).toBeVisible();
    }
    expect(header.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("navigation", { name: "Main mobile" })).toBeInTheDocument();

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

  describe("closing the assistant while a message is pending", () => {
    async function sendPending() {
      const send = vi.spyOn(api, "sendChatMessage").mockReturnValue(new Promise(() => {}));
      fireEvent.click(screen.getByRole("button", { name: "AI Assistant" }));
      const input = await screen.findByLabelText("Message the assistant");
      fireEvent.change(input, { target: { value: "What is overdue?" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      return send.mock.calls[0]![1] as AbortSignal;
    }

    it("aborts the request when the docked panel is closed", async () => {
      setViewportWidth(1280);
      renderShell();
      const signal = await sendPending();
      expect(signal.aborted).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));

      expect(signal.aborted).toBe(true);
    });

    it("aborts the request when the mobile drawer is dismissed with Escape", async () => {
      setViewportWidth(500);
      renderShell();
      const signal = await sendPending();

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(signal.aborted).toBe(true);
    });

    it("aborts the request when the account is switched", async () => {
      setViewportWidth(1280);
      renderShell();
      const signal = await sendPending();

      fireEvent.pointerDown(screen.getByRole("button", { name: "Account menu" }), { button: 0 });
      fireEvent.click(await screen.findByText("Switch account"));

      expect(signal.aborted).toBe(true);
    });
  });

  it("logs out through the account menu: clears cached queries and navigates to login", async () => {
    setViewportWidth(320);
    window.localStorage.setItem("planora.profile", "hamster_knight");
    renderShell();
    const clearSpy = vi.spyOn(qc, "clear");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Account menu" }), { button: 0 });
    fireEvent.click(await screen.findByText("Switch account"));

    expect(window.localStorage.getItem("planora.profile")).toBeNull();
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });
  it("shows the selected account's name and illustration in the header, not initials", () => {
    window.localStorage.setItem("planora.profile", "ech_princess");
    renderShell();

    const header = within(screen.getByRole("banner"));
    expect(header.getByLabelText("Selected account")).toHaveTextContent(/^Ech Princess$/);
    const trigger = header.getByRole("button", { name: "Account menu" });
    expect(trigger.querySelector('svg[aria-hidden="true"][data-mascot="frog"]')).not.toBeNull();
    expect(trigger).not.toHaveTextContent("EP");
    // The button's aria-label replaces its content, so the name is announced as its description.
    expect(trigger).toHaveAccessibleDescription("Ech Princess");
    // The old standalone line under the header is gone: the name exists exactly once.
    expect(screen.getAllByLabelText("Selected account")).toHaveLength(1);
  });

  it("shows the knight for Hamster Knight", () => {
    window.localStorage.setItem("planora.profile", "hamster_knight");
    renderShell();

    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger.querySelector('svg[data-mascot="hamster"]')).not.toBeNull();
    expect(screen.getByLabelText("Selected account")).toHaveTextContent(/^Hamster Knight$/);
    expect(trigger).toHaveAccessibleDescription("Hamster Knight");
  });

  it("gives the AI Assistant button its own icon, distinct from the brand mark", () => {
    renderShell();
    const assistant = screen.getByRole("button", { name: "AI Assistant" });
    expect(assistant.querySelector("svg.lucide-bot")).not.toBeNull();
    expect(assistant.querySelector("svg.lucide-sparkles")).toBeNull();
  });

  describe("theme in the account menu", () => {
    async function openMenu() {
      fireEvent.pointerDown(screen.getByRole("button", { name: "Account menu" }), { button: 0 });
      return screen.findByRole("menu");
    }

    it("lists System, Light, Dark and Colorful as radios under a Theme label, System checked by default", async () => {
      window.localStorage.removeItem(THEME_KEY);
      renderShell();
      const menu = within(await openMenu());

      expect(menu.getByText("Theme")).toBeVisible();
      const group = menu.getByRole("group", { name: "Theme" });
      const items = within(group).getAllByRole("menuitemradio");
      expect(items.map((item) => item.textContent)).toEqual([
        "System",
        "Light",
        "Dark",
        "Colorful",
      ]);
      expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
        "true",
        "false",
        "false",
        "false",
      ]);
      expect(menu.getByRole("menuitem", { name: "Switch account" })).toBeVisible();
    });

    it("applies a chosen theme at once, stores it, and shows it checked when reopened", async () => {
      window.localStorage.removeItem(THEME_KEY);
      const getProfiles = vi.spyOn(api, "getProfiles");
      renderShell();
      fireEvent.click(within(await openMenu()).getByRole("menuitemradio", { name: "Colorful" }));

      expect(document.documentElement.dataset["theme"]).toBe("colorful");
      expect(window.localStorage.getItem(THEME_KEY)).toBe("colorful");
      expect(getProfiles).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

      const reopened = within(await openMenu());
      expect(reopened.getByRole("menuitemradio", { name: "Colorful" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(reopened.getByRole("menuitemradio", { name: "System" })).toHaveAttribute(
        "aria-checked",
        "false",
      );
    });

    it("treats an invalid stored value as System", async () => {
      window.localStorage.setItem(THEME_KEY, "neon");
      renderShell();
      expect(
        within(await openMenu()).getByRole("menuitemradio", { name: "System" }),
      ).toHaveAttribute("aria-checked", "true");
    });
  });
});

describe("Lock (#124)", () => {
  async function openMenuByKeyboard() {
    const trigger = screen.getByRole("button", { name: "Account menu" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    return within(await screen.findByRole("menu"));
  }

  it.each([320, 1280])(
    "opens by keyboard and offers Switch account and Lock as menu items at %ipx",
    async (width) => {
      setViewportWidth(width);
      renderShell();
      const menu = await openMenuByKeyboard();

      const names = menu.getAllByRole("menuitem").map((item) => item.textContent?.trim());
      expect(names).toEqual(["Switch account", "Lock"]);
      for (const item of menu.getAllByRole("menuitem"))
        expect(item).not.toHaveAttribute("aria-disabled", "true");
    },
  );

  it("locks: calls api.lock, clears the cache, closes the chat panel and goes to /login", async () => {
    setViewportWidth(1280);
    setAccessState("unlocked");
    const lock = vi.spyOn(api, "lock").mockResolvedValue(undefined);
    renderShell();
    const clearSpy = vi.spyOn(qc, "clear");
    qc.setQueryData(["tasks"], ["Knight only"]);
    const toggle = screen.getByRole("button", { name: "AI Assistant" });
    fireEvent.click(toggle);
    await screen.findByRole("button", { name: "Close assistant" });

    fireEvent.click((await openMenuByKeyboard()).getByRole("menuitem", { name: "Lock" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/login", replace: true }));
    expect(lock).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData(["tasks"])).toBeUndefined();
    expect(getAccessState()).toBe("locked");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the remembered account but forgets that this browser was unlocked", async () => {
    window.localStorage.setItem("planora.profile", "hamster_knight");
    vi.spyOn(api, "lock").mockResolvedValue(undefined);
    renderShell();
    fireEvent.click((await openMenuByKeyboard()).getByRole("menuitem", { name: "Lock" }));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(window.localStorage.getItem("planora.profile")).toBe("hamster_knight");
  });

  it("stays put and shows an alert when locking fails, then locks on retry", async () => {
    setAccessState("unlocked");
    const lock = vi
      .spyOn(api, "lock")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    renderShell();
    const clearSpy = vi.spyOn(qc, "clear");

    fireEvent.click((await openMenuByKeyboard()).getByRole("menuitem", { name: "Lock" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't lock. Try again.");
    expect(navigate).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(getAccessState()).toBe("unlocked");
    expect(screen.getByText("board content")).toBeVisible();

    fireEvent.click((await openMenuByKeyboard()).getByRole("menuitem", { name: "Lock" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/login", replace: true }));
    expect(lock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

afterEach(() => resetAccessState());
