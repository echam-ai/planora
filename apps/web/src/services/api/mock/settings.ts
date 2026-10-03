import { ApiError, type AppSettings } from "@/types";
import type { ApiClient } from "../ApiClient";
import { KEYS, delay, createStore, type MockStore } from "./store";
const AVAILABLE_MODELS = ["kimi-k3"];
const DEFAULT_SETTINGS: AppSettings = {
  timezone: "Asia/Singapore",
  modelName: "kimi-k3",
  availableModels: AVAILABLE_MODELS,
};
export function currentTimezone(store: MockStore = createStore("hamster_knight")): string {
  return store.read<Partial<AppSettings>>(KEYS.settings, {}).timezone ?? DEFAULT_SETTINGS.timezone;
}
export function createSettingsClient(
  store: MockStore,
): Pick<ApiClient, "getSettings" | "updateSettings"> {
  function effectiveSettings(): AppSettings {
    const stored = store.read<Partial<AppSettings>>(KEYS.settings, {});
    return {
      timezone: stored.timezone ?? DEFAULT_SETTINGS.timezone,
      modelName: AVAILABLE_MODELS.includes(stored.modelName ?? "") ? stored.modelName! : "kimi-k3",
      availableModels: AVAILABLE_MODELS,
    };
  }
  return {
    async getSettings() {
      await delay();
      return effectiveSettings();
    },
    async updateSettings(patch) {
      await delay();
      store.maybeFail("save settings");
      const modelName = patch.modelName?.trim();
      if (modelName !== undefined && !AVAILABLE_MODELS.includes(modelName))
        throw new ApiError("VALIDATION_ERROR", "Choose one of the available models.");
      const next = {
        ...effectiveSettings(),
        ...(patch.timezone !== undefined && { timezone: patch.timezone }),
        ...(modelName !== undefined && { modelName }),
      };
      store.write(KEYS.settings, { timezone: next.timezone, modelName: next.modelName });
      return next;
    },
  };
}
