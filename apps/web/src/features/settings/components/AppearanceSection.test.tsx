import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSection } from "@/features/settings/components/AppearanceSection";
import { THEME_KEY } from "@/lib/theme";
import { api } from "@/services/api";

beforeEach(() => localStorage.removeItem(THEME_KEY));
afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  vi.restoreAllMocks();
});

describe("AppearanceSection", () => {
  it("offers exactly System, Light, Dark and Colorful as a Theme radio group", () => {
    render(<AppearanceSection />);
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeVisible();
    expect(screen.getByText("Applies to this browser, for both accounts.")).toBeVisible();
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => (radio as HTMLInputElement).value),
    ).toEqual(["system", "light", "dark", "colorful"]);
    for (const name of ["System", "Light", "Dark", "Colorful"]) {
      expect(within(group).getByRole("radio", { name })).toBeVisible();
    }
  });

  it("starts on System when nothing valid is stored", () => {
    localStorage.setItem(THEME_KEY, "neon");
    render(<AppearanceSection />);
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
  });

  it("applies a choice immediately, stores it, and calls no ApiClient method", () => {
    const calls = [
      vi.spyOn(api, "updateSettings"),
      vi.spyOn(api, "getSettings"),
      vi.spyOn(api, "getProfiles"),
    ];
    render(<AppearanceSection />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    for (const spy of calls) expect(spy).not.toHaveBeenCalled();
  });

  it("previews each theme with its own tokens", () => {
    const { container } = render(<AppearanceSection />);
    const scopes = Array.from(container.querySelectorAll("[data-theme]")).map((node) =>
      node.getAttribute("data-theme"),
    );
    // System previews light and dark side by side.
    expect(scopes).toEqual(["light", "dark", "light", "dark", "colorful"]);
  });
});
