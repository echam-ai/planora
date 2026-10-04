import { ApiError } from "@/types";
import type { ApiClient } from "../ApiClient";
import { hasWindow } from "./store";

/**
 * The mock's stand-in for the API's site-password gate (#124). It reuses the API's error codes
 * and messages verbatim so a page cannot tell the adapters apart (acceptance criterion 16).
 *
 * `focusboard` is the demo password the login page shows when `DEMO_UI_ENABLED`. This module is
 * only reachable from the mock adapter, which an `http` build tree-shakes away together with the
 * password (checked by grepping the build output).
 */
export const MOCK_PASSWORD = "focusboard";
export const ACCESS_KEY = "planora.access";

export function notAuthenticated(): ApiError {
  return new ApiError("NOT_AUTHENTICATED", "Authentication is required.", { status: 401 });
}

function incorrectPassword(): ApiError {
  return new ApiError("INVALID_PASSWORD", "Incorrect password.", { status: 401 });
}

function storage(): Storage | null {
  if (!hasWindow()) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Stored in the browser so an unlock survives a reload, like the API's cookie does. */
export const mockAccess = {
  isUnlocked(): boolean {
    try {
      return storage()?.getItem(ACCESS_KEY) === "1";
    } catch {
      return false;
    }
  },
  unlock() {
    storage()?.setItem(ACCESS_KEY, "1");
  },
  lock() {
    storage()?.removeItem(ACCESS_KEY);
  },
};

export type AccessClient = Pick<ApiClient, "getAccess" | "unlock" | "lock">;

export const ACCESS_METHODS = ["getAccess", "unlock", "lock"] as const;

export function createAccessClient(): AccessClient {
  return {
    async getAccess() {
      return { authenticated: mockAccess.isUnlocked() };
    },
    async unlock(password) {
      if (password !== MOCK_PASSWORD) throw incorrectPassword();
      mockAccess.unlock();
    },
    async lock() {
      mockAccess.lock();
    },
  };
}

/** Rejects every data method with the API's 401 while locked, before anything else is checked. */
export function gateData<T extends object>(client: T): T {
  return Object.fromEntries(
    Object.entries(client).map(([name, method]) => [
      name,
      (...args: unknown[]) =>
        mockAccess.isUnlocked()
          ? (method as (...args: unknown[]) => unknown)(...args)
          : Promise.reject(notAuthenticated()),
    ]),
  ) as T;
}
