import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/settings";
import { api } from "@/services/api";

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

beforeAll(() => {
  // Radix Select relies on pointer capture and scrolling APIs jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => vi.restoreAllMocks());

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Route.options.component!),
    ),
  );
}

function signedIn(availableModels: string[]) {
  vi.spyOn(api, "getSession").mockResolvedValue({
    username: "demo",
    signedInAt: new Date().toISOString(),
  });
  vi.spyOn(api, "getSettings").mockResolvedValue({
    timezone: "Asia/Singapore",
    modelName: "kimi-k3",
    availableModels,
  });
}

describe("Settings route — assistant model", () => {
  it("lists exactly the available models and saves the chosen one", async () => {
    signedIn(["kimi-k3", "kimi-k3-thinking"]);
    const update = vi.spyOn(api, "updateSettings").mockResolvedValue({
      timezone: "Asia/Singapore",
      modelName: "kimi-k3-thinking",
      availableModels: ["kimi-k3", "kimi-k3-thinking"],
    });
    renderSettings();

    const trigger = await screen.findByRole("combobox", { name: "Assistant model" });
    await waitFor(() => expect(trigger).toHaveTextContent("kimi-k3"));
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["kimi-k3", "kimi-k3-thinking"]);

    const option = within(listbox).getByRole("option", { name: "kimi-k3-thinking" });
    fireEvent.pointerUp(option, { pointerType: "mouse" });
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        timezone: "Asia/Singapore",
        modelName: "kimi-k3-thinking",
      }),
    );
  });

  it("shows the single available model as the only option", async () => {
    signedIn(["kimi-k3"]);
    renderSettings();

    const trigger = await screen.findByRole("combobox", { name: "Assistant model" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(1);
    expect(within(listbox).getByRole("option", { name: "kimi-k3" })).toBeInTheDocument();
  });
});
