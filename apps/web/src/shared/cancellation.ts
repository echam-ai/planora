import { useCallback, useEffect, useRef } from "react";
import { useSelectedProfile } from "@/services/api/profiles";

/** True for the error a cancelled `fetch` or mock call rejects with. Never an `ApiError`. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

/**
 * Owns the `AbortController` of one in-flight AI request. The request is aborted by
 * `abort()`, when the component using it unmounts, and when the selected account changes, so
 * a late result can never reach the screen, the query cache or the other profile.
 */
export function useCancellableRequest() {
  const profile = useSelectedProfile();
  const current = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    current.current?.abort();
  }, []);

  /** Starts a new request, aborting any earlier one, and returns its controller. */
  const begin = useCallback(() => {
    abort();
    const controller = new AbortController();
    current.current = controller;
    return controller;
  }, [abort]);

  /** True unless a newer request has started since `controller` did. */
  const isLatest = useCallback((controller: AbortController) => current.current === controller, []);

  // The cleanup runs on unmount and whenever `profile` changes.
  useEffect(() => abort, [abort, profile]);

  return { begin, abort, isLatest };
}
