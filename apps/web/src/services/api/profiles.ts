import { useSyncExternalStore } from "react";
import { z } from "zod";
export const profileIdSchema = z.enum(["hamster_knight", "ech_princess"]);
export type ProfileId = z.infer<typeof profileIdSchema>;
export const PROFILES = [
  { id: "hamster_knight", name: "Hamster Knight" },
  { id: "ech_princess", name: "Ech Princess" },
] as const;
export const PROFILE_KEY = "planora.profile";
export function getSelectedProfile(): ProfileId | null {
  if (typeof window === "undefined") return null;
  const parsed = profileIdSchema.safeParse(window.localStorage.getItem(PROFILE_KEY));
  return parsed.success ? parsed.data : null;
}
export function selectProfile(profile: ProfileId | null) {
  if (profile) window.localStorage.setItem(PROFILE_KEY, profileIdSchema.parse(profile));
  else window.localStorage.removeItem(PROFILE_KEY);
  window.dispatchEvent(new Event("planora-profile"));
}
function subscribe(callback: () => void) {
  window.addEventListener("planora-profile", callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("planora-profile", callback);
    window.removeEventListener("storage", callback);
  };
}
export function useSelectedProfile() {
  // Undefined means the browser snapshot has not been read during hydration;
  // null means it was read and no valid profile was selected.
  return useSyncExternalStore<ProfileId | null | undefined>(
    subscribe,
    getSelectedProfile,
    () => undefined,
  );
}
