import type { ProfileId } from "../profiles";
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

/** Resolves after a random wait. An aborted `signal` rejects at once with its reason. */
export function delay(min = 250, max = 600, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      min + Math.random() * (max - min),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function nowIso() {
  return new Date().toISOString();
}

export function createStore(profile: ProfileId) {
  const scopedKey = (key: string) =>
    key === KEYS.forceError ? key : `planora.${profile}.${key.slice(8)}`;
  function migrate() {
    if (!hasWindow()) return;
    for (const key of [KEYS.tasks, KEYS.settings, KEYS.conversation]) {
      const legacy = window.localStorage.getItem(key);
      const target = `planora.hamster_knight.${key.slice(8)}`;
      if (legacy !== null) {
        if (window.localStorage.getItem(target) === null)
          window.localStorage.setItem(target, legacy);
        window.localStorage.removeItem(key);
      }
    }
    window.localStorage.removeItem(KEYS.session);
    window.localStorage.removeItem(KEYS.password);
  }
  const scopedRead = <T>(key: string, fallback: T): T => {
    migrate();
    return read(scopedKey(key), fallback);
  };
  const scopedWrite = <T>(key: string, value: T) => {
    migrate();
    write(scopedKey(key), value);
  };
  function ensureTasks(): Task[] {
    if (!hasWindow()) return [];
    const existing = scopedRead<Task[] | null>(KEYS.tasks, null);
    if (existing !== null) return existing;
    const seeded = profile === "hamster_knight" ? createSeedTasks() : [];
    scopedWrite(KEYS.tasks, seeded);
    return seeded;
  }

  function saveTasks(tasks: Task[]) {
    scopedWrite(KEYS.tasks, tasks);
  }
  function maybeFail(action: string) {
    if (scopedRead<boolean>(KEYS.forceError, false))
      throw new ApiError("SIMULATED_FAILURE", `Simulated failure while trying to ${action}.`);
  }
  function reset() {
    if (!hasWindow()) return;
    migrate();
    for (const key of [KEYS.tasks, KEYS.settings, KEYS.conversation])
      window.localStorage.removeItem(scopedKey(key));
    ensureTasks();
  }
  function hasForeignTask(id: string) {
    const other = profile === "hamster_knight" ? "ech_princess" : "hamster_knight";
    return read<Task[]>(`planora.${other}.tasks`, []).some((task) => task.id === id);
  }
  return {
    read: scopedRead,
    write: scopedWrite,
    ensureTasks,
    saveTasks,
    maybeFail,
    reset,
    hasForeignTask,
  };
}
export type MockStore = ReturnType<typeof createStore>;
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
