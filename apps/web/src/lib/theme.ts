import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * Theme is a display preference of the browser, not of a profile: the chooser renders before any
 * profile exists, and profile settings are persisted by the API. So it lives in one
 * `localStorage` value, is never sent to the API, and survives switching accounts.
 */
export const THEME_KEY = "planora.theme";

export const themePreferenceSchema = z.enum(["system", "light", "dark", "colorful"]);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;
export type ResolvedTheme = Exclude<ThemePreference, "system">;

/** Order is the order the controls list them. */
export const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "colorful", label: "Colorful" },
];

const CHANGE_EVENT = "planora-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function parseThemePreference(raw: unknown): ThemePreference {
  const parsed = themePreferenceSchema.safeParse(raw);
  return parsed.success ? parsed.data : "system";
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

export function getStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

function darkQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY)
    : null;
}

/** Put the resolved theme on `<html>`. Safe to call repeatedly. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, darkQuery()?.matches ?? false);
  document.documentElement.setAttribute("data-theme", resolved);
  return resolved;
}

export function setTheme(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Blocked storage: the choice still applies to this page view.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  const sync = () => {
    applyTheme(getStoredTheme());
    onChange();
  };
  // The inline head script has already themed the page. Re-applying the stored preference here
  // changes nothing in the normal case, and catches an OS or storage change that landed between
  // that script and hydration.
  applyTheme(getStoredTheme());
  const query = darkQuery();
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", sync);
  query?.addEventListener("change", sync);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", sync);
    query?.removeEventListener("change", sync);
  };
}

/**
 * The stored preference. The server snapshot is `system`, so the first client render matches the
 * server HTML; the real value arrives right after hydration. Mounting this hook also keeps
 * `System` following the operating system's color scheme.
 */
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, getStoredTheme, () => "system" as const);
  const setPreference = useCallback((next: ThemePreference) => setTheme(next), []);
  return { preference, setPreference };
}
