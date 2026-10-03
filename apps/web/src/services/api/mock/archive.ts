import { ApiError } from "@/types";
import type { ApiClient, ArchivePage } from "../ApiClient";
import { delay, normalisePositions, nowIso, createStore, type MockStore } from "./store";

export function createArchiveClient(
  store: MockStore = createStore("hamster_knight"),
): Pick<ApiClient, "listArchive" | "getArchivedTask" | "restoreTask" | "permanentlyDeleteTask"> {
  const { ensureTasks, maybeFail, saveTasks } = store;
  return {
    async listArchive(search = "", page = 1): Promise<ArchivePage> {
      await delay();
      const pageSize = 10;
      const all = ensureTasks()
        .filter((task) => task.archivedAt)
        .filter((task) => task.title.toLowerCase().includes(search.trim().toLowerCase()))
        .sort(
          (a, b) =>
            new Date(b.completedAt ?? b.archivedAt!).getTime() -
            new Date(a.completedAt ?? a.archivedAt!).getTime(),
        );
      return {
        items: all.slice((page - 1) * pageSize, page * pageSize),
        total: all.length,
        page,
        pageSize,
      };
    },
    async getArchivedTask(id) {
      await delay(150, 300);
      const task = ensureTasks().find((candidate) => candidate.id === id && candidate.archivedAt);
      if (!task)
        throw new ApiError("NOT_FOUND", "That archived task no longer exists.", { status: 404 });
      return task;
    },
    async restoreTask(id) {
      await delay();
      maybeFail("restore the task");
      const tasks = ensureTasks();
      const task = tasks.find((candidate) => candidate.id === id && candidate.archivedAt);
      if (!task)
        throw new ApiError("NOT_FOUND", "That archived task no longer exists.", { status: 404 });
      task.archivedAt = null;
      task.completedAt = null;
      task.status = "todo";
      task.updatedAt = nowIso();
      task.position = tasks.filter(
        (candidate) => !candidate.archivedAt && candidate.status === "todo",
      ).length;
      saveTasks(normalisePositions(tasks));
      return task;
    },
    async permanentlyDeleteTask(id) {
      await delay();
      maybeFail("delete the task");
      const tasks = ensureTasks();
      if (!tasks.some((task) => task.id === id && task.archivedAt))
        throw new ApiError("NOT_FOUND", "That archived task no longer exists.", { status: 404 });
      saveTasks(tasks.filter((task) => task.id !== id));
    },
  };
}
