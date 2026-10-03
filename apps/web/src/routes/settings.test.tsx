import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { toast } from "sonner";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { Route } from "@/routes/settings";
import { api } from "@/services/api";
import { qk } from "@/shared/queryKeys";

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

let lastClient: QueryClient;

afterEach(() => {
  vi.restoreAllMocks();
  toast.dismiss(); // the toast store is module-global; keep one test's toast out of the next
});

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastClient = queryClient;
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Route.options.component!),
    ),
  );
}

function signedIn(availableModels: string[]) {
  window.localStorage.setItem("planora.profile", "hamster_knight");
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

const TOKYO = { timezone: "Asia/Tokyo", modelName: "kimi-k3", availableModels: ["kimi-k3"] };

function signedInOnly() {
  window.localStorage.setItem("planora.profile", "hamster_knight");
}

describe("Settings route — load failure", () => {
  it("shows an alert and Try again, and hides the form, while settings cannot load", async () => {
    signedInOnly();
    vi.spyOn(api, "getSettings").mockRejectedValue(new Error("offline"));
    const update = vi.spyOn(api, "updateSettings");
    renderSettings();

    const alert = await screen.findByText("We couldn't load your settings.");
    expect(alert).toHaveAttribute("role", "alert");
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toHaveClass("min-h-11");
    expect(screen.queryByRole("combobox", { name: "Timezone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Assistant model" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("never calls updateSettings when Try again still fails", async () => {
    signedInOnly();
    const get = vi.spyOn(api, "getSettings").mockRejectedValue(new Error("offline"));
    const update = vi.spyOn(api, "updateSettings");
    renderSettings();

    await screen.findByText("We couldn't load your settings.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await screen.findByText("We couldn't load your settings.");
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("loads the form with real values after Try again and saves exactly them", async () => {
    signedInOnly();
    const get = vi
      .spyOn(api, "getSettings")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(TOKYO);
    const update = vi.spyOn(api, "updateSettings").mockResolvedValue(TOKYO);
    renderSettings();

    await screen.findByText("We couldn't load your settings.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    const save = await screen.findByRole("button", { name: "Save changes" });
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("combobox", { name: "Timezone" })).toHaveTextContent("Asia/Tokyo");
    expect(screen.getByRole("combobox", { name: "Assistant model" })).toHaveTextContent("kimi-k3");
    expect(screen.queryByText("We couldn't load your settings.")).not.toBeInTheDocument();

    fireEvent.click(save);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ timezone: "Asia/Tokyo", modelName: "kimi-k3" }),
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("has no placeholder frame when the form first appears", async () => {
    signedInOnly();
    vi.spyOn(api, "getSettings").mockResolvedValue({
      timezone: "Europe/Berlin",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    renderSettings();

    await screen.findByRole("button", { name: "Save changes" });
    expect(screen.getByRole("combobox", { name: "Timezone" })).toHaveTextContent("Europe/Berlin");
    expect(screen.getByRole("combobox", { name: "Assistant model" })).toHaveTextContent("kimi-k3");
  });

  it("keeps the form and loaded values when a background refetch fails", async () => {
    signedInOnly();
    const get = vi.spyOn(api, "getSettings").mockResolvedValue({
      timezone: "Asia/Singapore",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    renderSettings();
    await screen.findByRole("button", { name: "Save changes" });

    get.mockRejectedValue(new Error("offline"));
    await lastClient.refetchQueries({ queryKey: ["settings"] });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    expect(screen.queryByText("We couldn't load your settings.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Timezone" })).toHaveTextContent("Asia/Singapore");
  });

  it("shows the skeleton and no Save changes while settings are pending", async () => {
    signedInOnly();
    vi.spyOn(api, "getSettings").mockReturnValue(new Promise(() => {}));
    const { container } = renderSettings();

    await screen.findByRole("heading", { name: "Preferences" });
    expect(container.querySelector('[data-slot="skeleton"], .animate-pulse')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.queryByText("We couldn't load your settings.")).not.toBeInTheDocument();
  });

  it("saves exactly the loaded values when nothing was edited", async () => {
    signedIn(["kimi-k3"]);
    const update = vi.spyOn(api, "updateSettings").mockResolvedValue({
      timezone: "Asia/Singapore",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
    renderSettings();

    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ timezone: "Asia/Singapore", modelName: "kimi-k3" }),
    );
  });
});

function renderWithToaster() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastClient = queryClient;
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Route.options.component!),
      createElement(Toaster),
    ),
  );
}

async function pickTimezone(name: string) {
  const trigger = await screen.findByRole("combobox", { name: "Timezone" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const option = within(await screen.findByRole("listbox")).getByRole("option", { name });
  fireEvent.pointerUp(option, { pointerType: "mouse" });
  fireEvent.click(option);
}

describe("Settings route — saving preferences", () => {
  it("saves the chosen timezone, toasts, and caches the resolved settings without refetching", async () => {
    signedIn(["kimi-k3"]);
    const get = vi.mocked(api.getSettings);
    const resolved = {
      timezone: "Asia/Tokyo",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3", "resolved-only"],
    };
    const update = vi.spyOn(api, "updateSettings").mockResolvedValue(resolved);
    renderWithToaster();

    await pickTimezone("Asia/Tokyo");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findAllByText("Settings saved")).length).toBeGreaterThan(0);
    expect(update).toHaveBeenCalledWith({ timezone: "Asia/Tokyo", modelName: "kimi-k3" });
    expect(lastClient.getQueryData(qk.settings)).toEqual(resolved);
    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Couldn't save your settings")).not.toBeInTheDocument();
  });

  it("shows an error toast when saving fails", async () => {
    signedIn(["kimi-k3"]);
    vi.spyOn(api, "updateSettings").mockRejectedValue(new Error("boom"));
    renderWithToaster();

    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));

    expect((await screen.findAllByText("Couldn't save your settings")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Settings saved")).not.toBeInTheDocument();
    expect(lastClient.getQueryData(qk.settings)).toEqual({
      timezone: "Asia/Singapore",
      modelName: "kimi-k3",
      availableModels: ["kimi-k3"],
    });
  });
});

describe("Settings route — stale stored model (mock client)", () => {
  it("shows the default model and saves a timezone change instead of failing", async () => {
    window.localStorage.setItem(
      "planora.hamster_knight.settings",
      JSON.stringify({ timezone: "Asia/Tokyo", modelName: "planora-pro" }),
    );
    try {
      window.localStorage.setItem("planora.profile", "hamster_knight");
      const update = vi.spyOn(api, "updateSettings"); // passthrough to the real mock
      renderWithToaster();

      const model = await screen.findByRole("combobox", { name: "Assistant model" });
      await waitFor(() => expect(model).toHaveTextContent("kimi-k3"), { timeout: 3000 });
      expect(screen.getByRole("combobox", { name: "Timezone" })).toHaveTextContent("Asia/Tokyo");

      await pickTimezone("Europe/London");
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

      expect((await screen.findAllByText("Settings saved", {}, { timeout: 3000 })).length).toBe(1);
      expect(update).toHaveBeenCalledWith({ timezone: "Europe/London", modelName: "kimi-k3" });
      await expect(update.mock.results[0]!.value).resolves.toMatchObject({
        timezone: "Europe/London",
        modelName: "kimi-k3",
      });
      expect(await api.getSettings()).toStrictEqual({
        timezone: "Europe/London",
        modelName: "kimi-k3",
        availableModels: ["kimi-k3"],
      });
    } finally {
      window.localStorage.clear();
      window.localStorage.setItem("planora.profile", "hamster_knight");
    }
  });
});
