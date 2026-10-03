import { getSelectedProfile, type ProfileId } from "./profiles";
import type { ApiClient } from "./ApiClient";
import { invalidApiModeMessage } from "./apiMode";
import { httpApiClient, createHttpApiClient } from "./http/httpApiClient";
import { mockApiClient, createMockApiClient } from "./mockApiClient";

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

const adapter = resolveApiClient();
const clients = new Map<string, ApiClient>();
export function scopedApi(profile: ProfileId | null): ApiClient {
  const key = profile ?? "none";
  if (!clients.has(key))
    clients.set(
      key,
      adapter === httpApiClient ? createHttpApiClient(profile) : createMockApiClient(profile),
    );
  return clients.get(key)!;
}
const forwardingClient: ApiClient = Object.fromEntries(
  Object.keys(adapter).map((name) => [
    name,
    (...args: unknown[]) => {
      const client = scopedApi(getSelectedProfile());
      return (client[name as keyof ApiClient] as (...args: unknown[]) => unknown)(...args);
    },
  ]),
) as unknown as ApiClient;
export const api: ApiClient = { ...forwardingClient };
/** Capture the immutable adapter and any seam interception when a hook mounts. */
export function captureApi(): ApiClient {
  const client = scopedApi(getSelectedProfile());
  return Object.fromEntries(
    Object.keys(client).map((name) => [
      name,
      api[name as keyof ApiClient] !== forwardingClient[name as keyof ApiClient]
        ? api[name as keyof ApiClient]
        : client[name as keyof ApiClient],
    ]),
  ) as unknown as ApiClient;
}

export type { ApiClient, ArchivePage } from "./ApiClient";
export { mockDevTools } from "./mockApiClient";
