import { ApiError, type Task, type TaskStatus } from "@/types";
import { uid } from "@/lib/id";
import type { ApiClient } from "../ApiClient";
import { KEYS, delay, ensureTasks, normalisePositions, nowIso, saveTasks, read } from "./store";

function maybeFail(action: string) {
  if (read<boolean>(KEYS.forceError, false)) {
    throw new ApiError("SIMULATED_FAILURE", `Simulated failure while trying to ${action}.`);
  }
}

export function createTasksClient(): Pick<
  ApiClient,
  "listTasks" | "getTask" | "createTask" | "updateTask" | "deleteTask" | "moveTask" | "reorderTasks"
> {
  return {
    async listTasks() {
      await delay();
      return ensureTasks().filter((task) => !task.archivedAt);
    },
    async getTask(id) {
      await delay(150, 300);
      const task = ensureTasks().find((candidate) => candidate.id === id);
      if (!task) throw new ApiError("NOT_FOUND", "That task no longer exists.");
      return task;
    },
    async createTask(draft) {
      await delay();
      maybeFail("create the task");
      const tasks = ensureTasks();
      const position = tasks.filter((task) => !task.archivedAt && task.status === "todo").length;
      const task: Task = {
        id: uid("task"),
        ...draft,
        status: "todo",
        position,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        completedAt: null,
        archivedAt: null,
      };
      saveTasks([...tasks, task]);
      return task;
    },
    async updateTask(id, patch) {
      await delay();
      maybeFail("save the task");
      const tasks = ensureTasks();
      const task = tasks.find((candidate) => candidate.id === id);
      if (!task) throw new ApiError("NOT_FOUND", "That task no longer exists.");
      Object.assign(task, patch, { updatedAt: nowIso() });
      if (patch.status === "done" && !task.completedAt) task.completedAt = nowIso();
      if (patch.status && patch.status !== "done") task.completedAt = null;
      saveTasks(normalisePositions(tasks));
      return task;
    },
    async deleteTask(id) {
      await delay();
      maybeFail("delete the task");
      saveTasks(normalisePositions(ensureTasks().filter((task) => task.id !== id)));
    },
    async moveTask(id, status, position) {
      await delay();
      maybeFail("move the task");
      const tasks = ensureTasks();
      const task = tasks.find((candidate) => candidate.id === id);
      if (!task) throw new ApiError("NOT_FOUND", "That task no longer exists.");
      const target = tasks
        .filter(
          (candidate) =>
            !candidate.archivedAt && candidate.status === status && candidate.id !== id,
        )
        .sort((a, b) => a.position - b.position);
      target.splice(Math.max(0, Math.min(position, target.length)), 0, task);
      task.status = status;
      task.updatedAt = nowIso();
      if (status === "done" && !task.completedAt) task.completedAt = nowIso();
      if (status !== "done") task.completedAt = null;
      target.forEach((candidate, index) => {
        candidate.position = index;
      });
      saveTasks(normalisePositions(tasks));
      return tasks.filter((candidate) => !candidate.archivedAt);
    },
    async reorderTasks(status: TaskStatus, orderedIds) {
      await delay();
      maybeFail("reorder tasks");
      const tasks = ensureTasks();
      orderedIds.forEach((id, index) => {
        const task = tasks.find((candidate) => candidate.id === id);
        if (task && task.status === status) task.position = index;
      });
      saveTasks(tasks);
      return tasks.filter((task) => !task.archivedAt);
    },
  };
}
