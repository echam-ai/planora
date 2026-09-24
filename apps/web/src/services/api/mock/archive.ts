import { ApiError } from "@/types";
import type { ApiClient, ArchivePage } from "../ApiClient";
import { KEYS, delay, ensureTasks, normalisePositions, nowIso, read, saveTasks } from "./store";

function maybeFail(action: string) {
  if (read<boolean>(KEYS.forceError, false)) {
    throw new ApiError("SIMULATED_FAILURE", `Simulated failure while trying to ${action}.`);
  }
}

export function createArchiveClient(): Pick<
  ApiClient,
  "listArchive" | "getArchivedTask" | "restoreTask" | "permanentlyDeleteTask"
> {
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
      if (!task) throw new ApiError("NOT_FOUND", "That archived task no longer exists.");
      return task;
    },
    async restoreTask(id) {
      await delay();
      maybeFail("restore the task");
      const tasks = ensureTasks();
      const task = tasks.find((candidate) => candidate.id === id);
      if (!task) throw new ApiError("NOT_FOUND", "That archived task no longer exists.");
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
      saveTasks(ensureTasks().filter((task) => task.id !== id));
    },
  };
}
