import { ApiError } from "@/types";
import type { Task, TaskStatus } from "@/types";
import { createSeedTasks } from "./seed";

export const KEYS = {
  tasks: "planora.tasks",
  settings: "planora.settings",
  session: "planora.session",
  conversation: "planora.conversation",
  password: "planora.password",
  forceError: "planora.forceError",
};

export const hasWindow = () => typeof window !== "undefined";

export function read<T>(key: string, fallback: T): T {
  if (!hasWindow()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function write<T>(key: string, value: T) {
  if (!hasWindow()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function delay(min = 250, max = 600) {
  return new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}

export function nowIso() {
  return new Date().toISOString();
}

export function ensureTasks(): Task[] {
  if (!hasWindow()) return [];
  const existing = read<Task[] | null>(KEYS.tasks, null);
  if (existing && existing.length) return existing;
  const seeded = createSeedTasks();
  write(KEYS.tasks, seeded);
  return seeded;
}

export function saveTasks(tasks: Task[]) {
  write(KEYS.tasks, tasks);
}

export function normalisePositions(tasks: Task[]): Task[] {
  const statuses: TaskStatus[] = ["todo", "in_progress", "done"];
  const active = tasks.filter((task) => !task.archivedAt);
  statuses.forEach((status) => {
    active
      .filter((task) => task.status === status)
      .sort((a, b) => a.position - b.position)
      .forEach((task, index) => {
        task.position = index;
      });
  });
  return tasks;
}

/** Throw a simulated failure when the mock's forced-error mode is on. */
export function maybeFail(action: string) {
  if (read<boolean>(KEYS.forceError, false)) {
    throw new ApiError("SIMULATED_FAILURE", `Simulated failure while trying to ${action}.`);
  }
}
