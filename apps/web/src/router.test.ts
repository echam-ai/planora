import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { getRouter } from "@/router";
import { qk } from "@/shared/queryKeys";
import { ApiError, type Session } from "@/types";

const SESSION: Session = { username: "demo", signedInAt: "2026-01-01T00:00:00Z" };

describe("getRouter", () => {
  it("wires a fresh query client into the router context", () => {
    const router = getRouter();

    expect(router.options.context?.queryClient).toBeInstanceOf(QueryClient);
  });

  it("gives every call its own query client, so requests never share cached state", () => {
    const first = getRouter();
    const second = getRouter();

    expect(first.options.context?.queryClient).not.toBe(second.options.context?.queryClient);
  });

  it("enables scroll restoration and always-fresh preloads", () => {
    const router = getRouter();

    expect(router.options.scrollRestoration).toBe(true);
    expect(router.options.defaultPreloadStaleTime).toBe(0);
  });
});

describe("session-expiry wiring", () => {
  it("clears the cached session when any query rejects with NOT_AUTHENTICATED", async () => {
    const router = getRouter();
    const queryClient = router.options.context!.queryClient;
    queryClient.setQueryData(qk.session, SESSION);

    await expect(
      queryClient.fetchQuery({
        queryKey: qk.tasks,
        queryFn: () => Promise.reject(new ApiError("NOT_AUTHENTICATED", "Sign in required.")),
        retry: false,
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(queryClient.getQueryData(qk.session)).toBeNull();
  });

  it("clears the cached session when any mutation rejects with NOT_AUTHENTICATED", async () => {
    const router = getRouter();
    const queryClient = router.options.context!.queryClient;
    queryClient.setQueryData(qk.session, SESSION);

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => Promise.reject(new ApiError("NOT_AUTHENTICATED", "Sign in required.")),
    });

    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(ApiError);
    expect(queryClient.getQueryData(qk.session)).toBeNull();
  });

  it("leaves the cached session alone when a login attempt rejects with INVALID_CREDENTIALS", async () => {
    const router = getRouter();
    const queryClient = router.options.context!.queryClient;
    queryClient.setQueryData(qk.session, SESSION);

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () =>
        Promise.reject(
          new ApiError("INVALID_CREDENTIALS", "That username or password isn't right."),
        ),
    });

    await expect(mutation.execute(undefined)).rejects.toBeInstanceOf(ApiError);
    expect(queryClient.getQueryData(qk.session)).toEqual(SESSION);
  });

  it("leaves the cached session alone for an error unrelated to authentication", async () => {
    const router = getRouter();
    const queryClient = router.options.context!.queryClient;
    queryClient.setQueryData(qk.session, SESSION);

    await expect(
      queryClient.fetchQuery({
        queryKey: qk.settings,
        queryFn: () => Promise.reject(new ApiError("NETWORK_ERROR", "Can't reach Planora.")),
        retry: false,
      }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(queryClient.getQueryData(qk.session)).toEqual(SESSION);
  });
});
