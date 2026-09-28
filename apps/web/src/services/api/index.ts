import type { ApiClient } from "./ApiClient";
import { invalidApiModeMessage } from "./apiMode";
import { httpApiClient } from "./http/httpApiClient";
import { mockApiClient } from "./mockApiClient";

/**
 * Selected once, at build time, from `VITE_API_MODE` (documented in
 * `apps/web/.env.example`). Page components import only `api`, never either
 * implementation directly — acceptance criterion 16.
 *
 * `vite.config.ts` validates the same variable via `apiMode.ts`'s
 * `assertValidApiMode`, so `vite build`/`vite dev` already fail immediately
 * on a typo. The check below is a runtime backstop for anything that
 * evaluates this module outside Vite's config (e.g. `vitest`, or a
 * hand-rolled script) — kept as direct literal comparisons, not a call into
 * `apiMode.ts`, so Vite can still statically fold the branch and
 * tree-shake the unused `ApiClient` implementation out of the bundle.
 */
function resolveApiClient(): ApiClient {
  const mode = import.meta.env.VITE_API_MODE;
  if (mode === "http") return httpApiClient;
  if (mode === "mock" || mode === undefined || mode === "") return mockApiClient;
  throw new Error(invalidApiModeMessage(mode));
}

export const api: ApiClient = resolveApiClient();

export type { ApiClient, ArchivePage } from "./ApiClient";
export { mockDevTools } from "./mockApiClient";
