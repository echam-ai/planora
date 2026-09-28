import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `services/api/index.ts` reads `import.meta.env.VITE_API_MODE` once, at
 * module-evaluation time, so each case here stubs the env var and forces a
 * fresh module instance before importing it.
 */
async function importApiModule() {
  vi.resetModules();
  return import("./index");
}

describe("services/api/index — build-time client selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("selects the mock client when VITE_API_MODE is unset", async () => {
    vi.stubEnv("VITE_API_MODE", undefined);

    const [{ api }, { mockApiClient }] = await Promise.all([
      importApiModule(),
      import("./mockApiClient"),
    ]);

    expect(api).toBe(mockApiClient);
  });

  it('selects the mock client when VITE_API_MODE is "mock"', async () => {
    vi.stubEnv("VITE_API_MODE", "mock");

    const { api } = await importApiModule();
    const { mockApiClient } = await import("./mockApiClient");

    expect(api).toBe(mockApiClient);
  });

  it('selects the http client when VITE_API_MODE is "http"', async () => {
    vi.stubEnv("VITE_API_MODE", "http");

    const { api } = await importApiModule();
    const { httpApiClient } = await import("./http/httpApiClient");

    expect(api).toBe(httpApiClient);
  });

  it("throws at module load for an invalid VITE_API_MODE, naming the variable and its allowed values", async () => {
    vi.stubEnv("VITE_API_MODE", "staging");

    await expect(importApiModule()).rejects.toThrow(/VITE_API_MODE/);
    await expect(importApiModule()).rejects.toThrow(/"http"/);
    await expect(importApiModule()).rejects.toThrow(/"mock"/);
  });
});
