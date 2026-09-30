import { ApiError, type AppSettings, type Session } from "@/types";
import type { ApiClient } from "../ApiClient";
import { KEYS, delay, ensureTasks, hasWindow, nowIso, read, write } from "./store";

const AVAILABLE_MODELS = ["kimi-k3"];
const DEFAULT_MODEL = "kimi-k3";
const DEFAULT_SETTINGS: AppSettings = {
  timezone: "Asia/Singapore",
  modelName: DEFAULT_MODEL,
  availableModels: AVAILABLE_MODELS,
};
const DEMO_USER = "demo";
const DEFAULT_PASSWORD = "focusboard";

/**
 * The settings the API would serve: the list is deployment configuration, never
 * stored, and a stored model that is no longer listed falls back to the default.
 */
function effectiveSettings(): AppSettings {
  const stored = read<Partial<AppSettings>>(KEYS.settings, {});
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  return {
    timezone: merged.timezone,
    modelName: AVAILABLE_MODELS.includes(merged.modelName) ? merged.modelName : DEFAULT_MODEL,
    availableModels: AVAILABLE_MODELS,
  };
}

/** The Settings timezone the mock currently holds. */
export function currentTimezone(): string {
  return { ...DEFAULT_SETTINGS, ...read<Partial<AppSettings>>(KEYS.settings, {}) }.timezone;
}

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
      return effectiveSettings();
    },
    async updateSettings(patch) {
      await delay();
      if (read<boolean>(KEYS.forceError, false)) {
        throw new ApiError("SIMULATED_FAILURE", "Simulated failure while trying to save settings.");
      }
      const modelName = patch.modelName?.trim();
      if (modelName !== undefined && !AVAILABLE_MODELS.includes(modelName)) {
        throw new ApiError("VALIDATION_ERROR", "Choose one of the available models.");
      }
      const current = effectiveSettings();
      const next: AppSettings = {
        ...current,
        ...(patch.timezone !== undefined && { timezone: patch.timezone }),
        ...(modelName !== undefined && { modelName }),
      };
      // The list is deployment configuration: return it, never persist it.
      const { availableModels: _list, ...persisted } = next;
      write(KEYS.settings, persisted);
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
