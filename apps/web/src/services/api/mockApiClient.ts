import { ApiError } from "@/types";
import type { ApiClient } from "./ApiClient";
import { PROFILES, profileIdSchema, type ProfileId } from "./profiles";
import { ACCESS_METHODS, createAccessClient, gateData } from "./mock/access";
import { createArchiveClient } from "./mock/archive";
import { createSettingsClient } from "./mock/settings";
import { createChatClient } from "./mock/chat";
import { KEYS, delay, createStore, read, write } from "./mock/store";
import { createTasksClient } from "./mock/tasks";
type DataClient = Omit<ApiClient, (typeof ACCESS_METHODS)[number]>;
function createDataClient(profile: ProfileId | null): DataClient {
  if (!profileIdSchema.safeParse(profile).success)
    return Object.fromEntries(
      Object.keys(mockApiClient)
        .filter((name) => !(ACCESS_METHODS as readonly string[]).includes(name))
        .map((name) => [
          name,
          name === "getProfiles"
            ? async () => PROFILES
            : async () => {
                throw new ApiError("VALIDATION_ERROR", "Choose an account first.", {
                  status: 422,
                });
              },
        ]),
    ) as unknown as DataClient;
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
export function createMockApiClient(profile: ProfileId | null): ApiClient {
  return { ...gateData(createDataClient(profile)), ...createAccessClient() };
}
export const mockApiClient = createMockApiClient("hamster_knight");
export const mockDevTools = {
  isErrorModeOn: () => read<boolean>(KEYS.forceError, false),
  setErrorMode: (on: boolean) => write(KEYS.forceError, on),
};
