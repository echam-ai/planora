/**
 * `VITE_API_MODE`'s allowed values, shared by two independent call sites
 * (issue #35, PM rejection on the first pass):
 *
 * - `vite.config.ts` calls `assertValidApiMode` against `loadEnv`'s result,
 *   so a typo (`VITE_API_MODE=HTTP`) or garbage value fails `vite build`
 *   and `vite dev` immediately, before any code runs.
 * - `services/api/index.ts` keeps its own runtime check as a backstop, in
 *   case this module is ever evaluated with an env var that bypassed Vite's
 *   config (e.g. a hand-rolled script). That check compares
 *   `import.meta.env.VITE_API_MODE` against string literals directly,
 *   rather than calling into this module, so Vite can still statically fold
 *   the branch and tree-shake the unused `ApiClient` implementation out of
 *   the bundle — see the comment there. It reuses `invalidApiModeMessage`
 *   only for the error text, so both checks report the same message.
 */
export const VALID_API_MODES = ["http", "mock"] as const;

export type ApiMode = (typeof VALID_API_MODES)[number];

/** Case-sensitive: `"HTTP"` is invalid, matching neither `"http"` nor `"mock"`. */
export function isValidApiMode(value: string | undefined): boolean {
  if (value === undefined || value === "") return true;
  return (VALID_API_MODES as readonly string[]).includes(value);
}

export function invalidApiModeMessage(value: string): string {
  return `Invalid VITE_API_MODE "${value}". Expected "http" or "mock" (unset defaults to "mock").`;
}

/** Throws `invalidApiModeMessage(value)` unless `value` is unset, empty, `"http"` or `"mock"`. */
export function assertValidApiMode(value: string | undefined): void {
  if (!isValidApiMode(value)) {
    throw new Error(invalidApiModeMessage(value as string));
  }
}
