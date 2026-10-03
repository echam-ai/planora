import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_KEY,
  applyTheme,
  getStoredTheme,
  parseThemePreference,
  resolveTheme,
  setTheme,
  useTheme,
} from "@/lib/theme";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";

type MediaListener = () => void;

/** A controllable `prefers-color-scheme: dark` media query. */
function stubColorScheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<MediaListener>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      media: query,
      get matches() {
        return dark;
      },
      addEventListener: (_: string, listener: MediaListener) => listeners.add(listener),
      removeEventListener: (_: string, listener: MediaListener) => listeners.delete(listener),
    })),
  );
  return {
    set(next: boolean) {
      dark = next;
      listeners.forEach((listener) => listener());
    },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseThemePreference", () => {
  it.each(["system", "light", "dark", "colorful"])("accepts %s", (value) => {
    expect(parseThemePreference(value)).toBe(value);
  });

  it.each([null, undefined, "", "neon", "DARK", 3])("falls back to system for %j", (value) => {
    expect(parseThemePreference(value)).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("follows the color scheme only for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("colorful", true)).toBe("colorful");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("stored preference", () => {
  it("is system when nothing or garbage is stored", () => {
    expect(getStoredTheme()).toBe("system");
    localStorage.setItem(THEME_KEY, "neon");
    expect(getStoredTheme()).toBe("system");
  });

  it("is system when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getStoredTheme()).toBe("system");
  });

  it("setTheme stores the choice, applies it, and survives blocked storage", () => {
    stubColorScheme(false);
    setTheme("colorful");
    expect(localStorage.getItem(THEME_KEY)).toBe("colorful");
    expect(document.documentElement.dataset["theme"]).toBe("colorful");

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setTheme("dark")).not.toThrow();
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("resolves system against the color scheme and tolerates no matchMedia", () => {
    stubColorScheme(true);
    expect(applyTheme("system")).toBe("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");

    vi.stubGlobal("matchMedia", undefined);
    expect(applyTheme("system")).toBe("light");
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });
});

describe("useTheme", () => {
  it("reports the stored preference and changes it without an API call", () => {
    stubColorScheme(false);
    localStorage.setItem(THEME_KEY, "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("dark");

    act(() => result.current.setPreference("colorful"));
    expect(result.current.preference).toBe("colorful");
    expect(document.documentElement.dataset["theme"]).toBe("colorful");
    expect(localStorage.getItem(THEME_KEY)).toBe("colorful");
  });

  it("follows a live color-scheme change while system is active", () => {
    const scheme = stubColorScheme(false);
    const { result, unmount } = renderHook(() => useTheme());
    act(() => result.current.setPreference("system"));
    expect(document.documentElement.dataset["theme"]).toBe("light");

    act(() => scheme.set(true));
    expect(document.documentElement.dataset["theme"]).toBe("dark");

    unmount();
    expect(scheme.listenerCount()).toBe(0);
  });

  it("applies the stored preference when it subscribes, covering a change since the head script ran", () => {
    stubColorScheme(true);
    localStorage.setItem(THEME_KEY, "system");
    document.documentElement.setAttribute("data-theme", "light");
    renderHook(() => useTheme());
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });

  it("picks up a change made in another tab", () => {
    stubColorScheme(false);
    const { result } = renderHook(() => useTheme());
    act(() => {
      localStorage.setItem(THEME_KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY, newValue: "dark" }));
    });
    expect(result.current.preference).toBe("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });
});

describe("THEME_BOOT_SCRIPT (inline, runs before first paint)", () => {
  const run = () => new Function(THEME_BOOT_SCRIPT)();

  it("applies a stored theme to <html>", () => {
    for (const theme of ["light", "dark", "colorful"]) {
      localStorage.setItem(THEME_KEY, theme);
      run();
      expect(document.documentElement.dataset["theme"]).toBe(theme);
    }
  });

  it("resolves system, missing and invalid values from the color scheme", () => {
    stubColorScheme(true);
    run();
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    localStorage.setItem(THEME_KEY, "neon");
    run();
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    vi.unstubAllGlobals();
    stubColorScheme(false);
    localStorage.setItem(THEME_KEY, "system");
    run();
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });

  it("falls back to light when storage and matchMedia are unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.stubGlobal("matchMedia", undefined);
    run();
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });

  it("agrees with the runtime parser for every stored value", () => {
    stubColorScheme(false);
    for (const raw of ["system", "light", "dark", "colorful", "neon", "", "Dark"]) {
      localStorage.setItem(THEME_KEY, raw);
      run();
      expect(document.documentElement.dataset["theme"]).toBe(
        resolveTheme(parseThemePreference(raw), false),
      );
    }
  });
});
