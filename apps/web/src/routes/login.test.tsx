import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { Route } from "./login";
import { api } from "@/services/api";
import { getAccessState, resetAccessState } from "@/features/auth/access";
import { ApiError } from "@/types";

const navigate = vi.fn();
const demo = vi.hoisted(() => ({ enabled: true }));

vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual("@tanstack/react-router")),
  useNavigate: () => navigate,
}));
vi.mock("@/services/api/demoUi", () => ({
  get DEMO_UI_ENABLED() {
    return demo.enabled;
  },
}));

const UnlockPage = Route.options.component!;

beforeEach(() => {
  demo.enabled = true;
  navigate.mockClear();
  resetAccessState();
});
afterEach(() => vi.restoreAllMocks());

const field = () => screen.getByLabelText("Password") as HTMLInputElement;
const button = () => screen.getByRole("button", { name: "Unlock" });
const form = () => field().closest("form")!;

async function submit(password: string) {
  fireEvent.change(field(), { target: { value: password } });
  await act(async () => {
    fireEvent.submit(form());
  });
}

describe("password page", () => {
  it("is titled Unlock — Planora", () => {
    const head = (Route.options.head as () => { meta: Array<Record<string, string>> })();
    expect(head.meta).toEqual(expect.arrayContaining([{ title: "Unlock — Planora" }]));
  });

  it("offers exactly one password field and an Unlock button, with the field focused", () => {
    render(<UnlockPage />);
    expect(screen.getAllByLabelText(/password/i)).toHaveLength(1);
    expect(field()).toHaveAttribute("type", "password");
    expect(field()).toHaveAttribute("autocomplete", "current-password");
    expect(field()).toHaveFocus();
    expect(button()).toHaveAttribute("type", "submit");
    expect(button()).toBeEnabled();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Unlock Planora");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("posts natively to /login when scripts have not run", () => {
    render(<UnlockPage />);
    expect(form()).toHaveAttribute("method", "post");
    expect(form()).toHaveAttribute("action", "/login");
    expect(field()).toHaveAttribute("name", "password");
  });

  it("server-renders the form with the button disabled until hydration", () => {
    const html = renderToString(createElement(UnlockPage));
    const host = document.createElement("div");
    host.innerHTML = html;
    expect(host.querySelector("form[method='post'][action='/login']")).not.toBeNull();
    expect(host.querySelector("input[type='password'][name='password']")).not.toBeNull();
    expect(host.querySelector("button[type='submit']")?.hasAttribute("disabled")).toBe(true);
  });

  it("unlocks, records the access and goes to the chooser", async () => {
    const unlock = vi.spyOn(api, "unlock").mockResolvedValue(undefined);
    render(<UnlockPage />);
    await submit("focusboard");
    expect(unlock).toHaveBeenCalledWith("focusboard");
    expect(getAccessState()).toBe("unlocked");
    expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("disables the button and marks it busy while the request is pending", async () => {
    let finish!: () => void;
    vi.spyOn(api, "unlock").mockReturnValue(new Promise((resolve) => (finish = () => resolve())));
    render(<UnlockPage />);
    await submit("focusboard");
    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute("aria-busy", "true");
    // A second submit while pending does nothing.
    await act(async () => {
      fireEvent.submit(form());
    });
    expect(api.unlock).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("shows a wrong password in an alert and returns focus to the field", async () => {
    vi.spyOn(api, "unlock").mockRejectedValue(
      new ApiError("INVALID_PASSWORD", "Incorrect password.", { status: 401 }),
    );
    render(<UnlockPage />);
    button().focus();
    await submit("nope");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Incorrect password.");
    expect(field()).toHaveFocus();
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(field()).toHaveAccessibleDescription("Incorrect password.");
    expect(button()).toBeEnabled();
    expect(button()).toHaveAttribute("aria-busy", "false");
    expect(navigate).not.toHaveBeenCalled();
    expect(getAccessState()).toBe("unknown");
  });

  it("shows the rate-limit message and lets the visitor try again later", async () => {
    vi.spyOn(api, "unlock").mockRejectedValue(
      new ApiError("RATE_LIMITED", "Too many incorrect attempts. Try again later.", {
        status: 429,
      }),
    );
    render(<UnlockPage />);
    await submit("nope");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many incorrect attempts. Try again later.",
    );
    expect(button()).toBeEnabled();
  });

  it("shows a recoverable message for a network failure and re-enables Unlock", async () => {
    vi.spyOn(api, "unlock").mockRejectedValue(
      new ApiError("NETWORK_ERROR", "Can't reach Planora. Check your connection and try again."),
    );
    render(<UnlockPage />);
    await submit("whatever");
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach Planora");
    expect(button()).toBeEnabled();
  });

  it("never shows raw status codes or stack text for an unexpected failure", async () => {
    vi.spyOn(api, "unlock").mockRejectedValue(
      new ApiError("INTERNAL_ERROR", "Traceback: boom at line 42", { status: 500 }),
    );
    render(<UnlockPage />);
    await submit("whatever");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't unlock. Try again.");
    expect(alert).not.toHaveTextContent(/500|traceback|line 42/i);
    expect(button()).toBeEnabled();
  });

  it("asks for a password instead of sending an empty one", async () => {
    const unlock = vi.spyOn(api, "unlock");
    render(<UnlockPage />);
    await submit("");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the password.");
    expect(unlock).not.toHaveBeenCalled();
    expect(field()).toHaveFocus();
  });

  it("clears the alert on the next attempt", async () => {
    const unlock = vi
      .spyOn(api, "unlock")
      .mockRejectedValueOnce(
        new ApiError("INVALID_PASSWORD", "Incorrect password.", { status: 401 }),
      )
      .mockResolvedValueOnce(undefined);
    render(<UnlockPage />);
    await submit("nope");
    await screen.findByRole("alert");
    await submit("right");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(unlock).toHaveBeenCalledTimes(2);
  });

  it("keeps text typed before hydration: the field is read from the DOM, not from state", async () => {
    const unlock = vi.spyOn(api, "unlock").mockResolvedValue(undefined);
    const html = renderToString(createElement(UnlockPage));
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    host.querySelector<HTMLInputElement>("input")!.value = "typed before hydration";
    const { hydrateRoot } = await import("react-dom/client");
    const root = hydrateRoot(host, createElement(UnlockPage));
    try {
      await act(async () => {});
      await act(async () => {
        fireEvent.submit(host.querySelector("form")!);
      });
      expect(unlock).toHaveBeenCalledWith("typed before hydration");
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

describe("demo password hint", () => {
  it("shows the mock password when demo UI is enabled", () => {
    demo.enabled = true;
    render(<UnlockPage />);
    expect(screen.getByText("focusboard")).toBeVisible();
  });

  it("is absent in an HTTP build (demo UI disabled)", () => {
    demo.enabled = false;
    render(<UnlockPage />);
    expect(screen.queryByText("focusboard")).toBeNull();
    expect(screen.queryByText(/demo password/i)).toBeNull();
  });
});
