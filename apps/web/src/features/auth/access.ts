import { useSyncExternalStore } from "react";
import { api } from "@/services/api";

/**
 * Whether this browser may use the app (#124): the one piece of state the whole route gate
 * hangs on. The cookie is HttpOnly, so the only way to know is to ask the API (`getAccess`);
 * the answer is kept here, outside every query client, so an account switch (which replaces
 * the profile-scoped client) does not forget it and flash the page blank.
 *
 * - `unknown`: nothing asked yet. The server render and the first browser render are always
 *   here, so private pages never render before the answer is in.
 * - `unlocked` / `locked`: the API's answer, or a later 401, unlock or lock.
 * - `unreachable`: the question itself failed (offline). The pages offer a retry.
 */
export type AccessState = "unknown" | "unlocked" | "locked" | "unreachable";

let state: AccessState = "unknown";
// Bumped by every change, so a slow answer to an older question cannot overwrite a newer fact
// (an unlock that finished while the first `getAccess` was still in flight).
let version = 0;
const listeners = new Set<() => void>();

export function getAccessState(): AccessState {
  return state;
}

export function setAccessState(next: AccessState) {
  version += 1;
  if (next === state) return;
  state = next;
  listeners.forEach((listener) => listener());
}

/** Test seam: back to the state of a fresh page load. */
export function resetAccessState() {
  state = "unknown";
  version += 1;
  listeners.forEach((listener) => listener());
}

/** Asks the API and records the answer, unless something else decided in the meantime. */
export async function refreshAccess(): Promise<void> {
  const asked = version;
  try {
    const { authenticated } = await api.getAccess();
    if (asked === version) setAccessState(authenticated ? "unlocked" : "locked");
  } catch {
    if (asked === version) setAccessState("unreachable");
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAccessState(): AccessState {
  return useSyncExternalStore(subscribe, getAccessState, () => "unknown");
}
