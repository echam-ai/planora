import { ApiError, type AppSettings, type Session } from "@/types";
import type { ApiClient } from "../ApiClient";
import { KEYS, delay, ensureTasks, hasWindow, nowIso, read, write } from "./store";

const DEFAULT_SETTINGS: AppSettings = { timezone: "Asia/Singapore", modelName: "kimi-k3" };
const DEMO_USER = "demo";
const DEFAULT_PASSWORD = "focusboard";

export function createAuthClient(): Pick<
  ApiClient,
  "login" | "logout" | "getSession" | "getSettings" | "updateSettings" | "changePassword"
> {
  return {
    async login(username, password) {
      await delay();
      const stored = read<string>(KEYS.password, DEFAULT_PASSWORD);
      if (username.trim().toLowerCase() !== DEMO_USER || password !== stored) {
        throw new ApiError("INVALID_CREDENTIALS", "That username or password isn't right.");
      }
      const session: Session = { username: DEMO_USER, signedInAt: nowIso() };
      write(KEYS.session, session);
      ensureTasks();
      return session;
    },
    async logout() {
      await delay(150, 300);
      if (hasWindow()) window.localStorage.removeItem(KEYS.session);
    },
    async getSession() {
      await delay(120, 260);
      return read<Session | null>(KEYS.session, null);
    },
    async getSettings() {
      await delay();
      return { ...DEFAULT_SETTINGS, ...read<Partial<AppSettings>>(KEYS.settings, {}) };
    },
    async updateSettings(patch) {
      await delay();
      if (read<boolean>(KEYS.forceError, false)) {
        throw new ApiError("SIMULATED_FAILURE", "Simulated failure while trying to save settings.");
      }
      const next = {
        ...DEFAULT_SETTINGS,
        ...read<Partial<AppSettings>>(KEYS.settings, {}),
        ...patch,
      };
      write(KEYS.settings, next);
      return next;
    },
    async changePassword(currentPassword, newPassword) {
      await delay();
      const stored = read<string>(KEYS.password, DEFAULT_PASSWORD);
      if (currentPassword !== stored) {
        throw new ApiError("WRONG_PASSWORD", "Your current password is incorrect.");
      }
      write(KEYS.password, newPassword);
    },
  };
}
