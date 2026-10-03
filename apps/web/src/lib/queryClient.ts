import { QueryClient } from "@tanstack/react-query";

/**
 * Every write goes through this app's own mutations, which update or
 * invalidate the cache, so reads can be served from cache for a short while
 * instead of refetching on every focus and navigation. Changes made elsewhere
 * (another tab, the hourly archival job) show up within this window.
 */
export const QUERY_STALE_TIME_MS = 30_000;

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: QUERY_STALE_TIME_MS } } });
}
