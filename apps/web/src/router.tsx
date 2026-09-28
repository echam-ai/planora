import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { qk } from "@/shared/queryKeys";
import { ApiError } from "@/types";

/**
 * A `401 NOT_AUTHENTICATED` from any query or mutation means the session
 * cookie died server-side mid-use — clear the cached session so the
 * existing `useAuthGuard` redirects to `/login`. Wired once here, through
 * `QueryCache`/`MutationCache`, instead of at each call site (issue #35).
 *
 * The login form never goes through this: it calls `api.login` directly
 * rather than through `useMutation`, and its own `401 INVALID_CREDENTIALS`
 * has a different `code`, so it is never mistaken for an expiry either way.
 */
function handleSessionExpiry(queryClient: QueryClient) {
  return (error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_AUTHENTICATED") {
      queryClient.setQueryData(qk.session, null);
    }
  };
}

export const getRouter = () => {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => handleSessionExpiry(queryClient)(error) }),
    mutationCache: new MutationCache({
      onError: (error) => handleSessionExpiry(queryClient)(error),
    }),
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
