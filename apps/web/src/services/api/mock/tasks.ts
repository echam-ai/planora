import { ApiError, type Task, type TaskStatus } from "@/types";
import { uid } from "@/lib/id";
import type { ApiClient } from "../ApiClient";
import { delay, normalisePositions, nowIso, createStore, type MockStore } from "./store";

export function createTasksClient(
  store: MockStore = createStore("hamster_knight"),
): Pick<
  ApiClient,
  "listTasks" | "getTask" | "createTask" | "updateTask" | "deleteTask" | "moveTask" | "reorderTasks"
> {
  const { ensureTasks, maybeFail, saveTasks, hasForeignTask } = store;
  return {
    async listTasks() {
      await delay();
      return ensureTasks().filter((task) => !task.archivedAt);
    },
    async getTask(id) {
      await delay(150, 300);
      const task = ensureTasks().find((candidate) => candidate.id === id && !candidate.archivedAt);
      if (!task) throw new ApiError("NOT_FOUND", "That task no longer exists.", { status: 404 });
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
      const task = tasks.find((candidate) => candidate.id === id && !candidate.archivedAt);
      if (!task) throw new ApiError("NOT_FOUND", "That task no longer exists.", { status: 404 });
      Object.assign(task, patch, { updatedAt: nowIso() });
      if (patch.status === "done" && !task.completedAt) task.completedAt = nowIso();
      if (patch.status && patch.status !== "done") task.completedAt = null;
      saveTasks(normalisePositions(tasks));
      return task;
    },
    async deleteTask(id) {
      await delay();
      maybeFail("delete the task");
      const tasks = ensureTasks();
      if (!tasks.some((task) => task.id === id && !task.archivedAt))
        throw new ApiError("NOT_FOUND", "That task no longer exists.", { status: 404 });
      saveTasks(normalisePositions(tasks.filter((task) => task.id !== id)));
    },
    async moveTask(id, status, position) {
      await delay();
      maybeFail("move the task");
      const tasks = ensureTasks();
      const task = tasks.find((candidate) => candidate.id === id && !candidate.archivedAt);
      if (!task) throw new ApiError("NOT_FOUND", "That task no longer exists.", { status: 404 });
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
      if (orderedIds.some((id) => hasForeignTask(id)))
        throw new ApiError("NOT_FOUND", "That task no longer exists.", { status: 404 });
      if (orderedIds.some((id) => !tasks.some((task) => task.id === id)))
        throw new ApiError("VALIDATION_ERROR", "Unknown task in ordering.", { status: 422 });
      orderedIds.forEach((id, index) => {
        const task = tasks.find((candidate) => candidate.id === id && !candidate.archivedAt);
        if (task && task.status === status) task.position = index;
      });
      saveTasks(tasks);
      return tasks.filter((task) => !task.archivedAt);
    },
  };
}
