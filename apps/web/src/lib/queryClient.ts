import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/types";

/**
 * Every write goes through this app's own mutations, which update or
 * invalidate the cache, so reads can be served from cache for a short while
 * instead of refetching on every focus and navigation. Changes made elsewhere
 * (another tab, the hourly archival job) show up within this window.
 */
export const QUERY_STALE_TIME_MS = 30_000;

const MAX_QUERY_RETRIES = 3;

/** The API's answer to any data call once the access cookie is missing, invalid or expired. */
export function isNotAuthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === "NOT_AUTHENTICATED";
}

/**
 * `onNotAuthenticated` runs when any query or mutation fails with 401 `NOT_AUTHENTICATED`
 * (#124): the session expired or was locked elsewhere. A wrong password from `unlock` is a
 * different code and never reaches it. Such an error is not retried, because retrying a
 * request the API has refused would only delay the redirect.
 */
export function createQueryClient(onNotAuthenticated?: () => void) {
  const onError = (error: unknown) => {
    if (isNotAuthenticated(error)) onNotAuthenticated?.();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        retry: (failureCount, error) =>
          !isNotAuthenticated(error) && failureCount < MAX_QUERY_RETRIES,
      },
    },
  });
}
