import type { ApiClient } from "./ApiClient";
import { createArchiveClient } from "./mock/archive";
import { createAuthClient } from "./mock/auth";
import { createChatClient } from "./mock/chat";
import { KEYS, delay, ensureTasks, hasWindow, read, write } from "./mock/store";
import { createTasksClient } from "./mock/tasks";

const authClient = createAuthClient();
const tasksClient = createTasksClient();
const archiveClient = createArchiveClient();
const chatClient = createChatClient(tasksClient);

export const mockApiClient: ApiClient = {
  ...authClient,
  ...tasksClient,
  ...archiveClient,
  ...chatClient,
  async resetDemoData() {
    await delay();
    if (!hasWindow()) return;
    window.localStorage.removeItem(KEYS.tasks);
    window.localStorage.removeItem(KEYS.conversation);
    window.localStorage.removeItem(KEYS.settings);
    ensureTasks();
  },
};

export const mockDevTools = {
  isErrorModeOn: () => read<boolean>(KEYS.forceError, false),
  setErrorMode: (on: boolean) => write(KEYS.forceError, on),
};
