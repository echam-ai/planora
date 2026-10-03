import { execFileSync } from "node:child_process";

import { apiEnv, runSettings, seedScript, uvArgs } from "./env";

/** Runs one `seed.py` command against this run's database and returns stdout. */
export function seed(...args: string[]): string {
  return execFileSync("uv", uvArgs("python", seedScript, ...args), {
    cwd: runSettings().dir,
    env: { ...process.env, ...apiEnv() },
    encoding: "utf8",
  }).trim();
}

export function seedTask(title: string, status: "todo" | "in_progress" | "done"): void {
  seed("seed-task", title, status);
}

export function seedArchivedTask(title: string): void {
  seed("seed-archived-task", title);
}

export function countTasks(title: string): number {
  return Number(seed("count-tasks", title));
}
