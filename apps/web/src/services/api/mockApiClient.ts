import { ApiError } from "@/types";
import type { ApiClient } from "./ApiClient";
import { PROFILES, profileIdSchema, type ProfileId } from "./profiles";
import { createArchiveClient } from "./mock/archive";
import { createSettingsClient } from "./mock/settings";
import { createChatClient } from "./mock/chat";
import { KEYS, delay, createStore, read, write } from "./mock/store";
import { createTasksClient } from "./mock/tasks";
export function createMockApiClient(profile: ProfileId | null): ApiClient {
  if (!profileIdSchema.safeParse(profile).success)
    return Object.fromEntries(
      Object.keys(mockApiClient).map((name) => [
        name,
        name === "getProfiles"
          ? async () => PROFILES
          : async () => {
              throw new ApiError("VALIDATION_ERROR", "Choose an account first.", { status: 422 });
            },
      ]),
    ) as unknown as ApiClient;
  const store = createStore(profile!);
  const tasks = createTasksClient(store);
  return {
    getProfiles: async () => PROFILES,
    ...createSettingsClient(store),
    ...tasks,
    ...createArchiveClient(store),
    ...createChatClient(tasks, store),
    async resetDemoData() {
      await delay();
      store.reset();
    },
  };
}
export const mockApiClient = createMockApiClient("hamster_knight");
export const mockDevTools = {
  isErrorModeOn: () => read<boolean>(KEYS.forceError, false),
  setErrorMode: (on: boolean) => write(KEYS.forceError, on),
};
