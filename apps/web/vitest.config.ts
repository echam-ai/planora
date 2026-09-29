import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    pool: "threads",
    maxWorkers: 1,
    exclude: [...configDefaults.exclude, "e2e/**"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.gen.ts", // generated (routeTree.gen.ts now, schema.gen.ts after #34); binding rule 4 forbids editing them
        "src/**/*.test.{ts,tsx}", // the tests themselves
        "src/test/**", // test setup and shared test helpers; nothing in production imports them
        "src/**/*.d.ts", // declarations only, no runtime code
        "src/components/ui/**", // unmodified shadcn/ui output (components.json); thin Radix wrappers, project logic lives in features/ and components/layout/
      ],
      thresholds: {
        // Rule 9 (#109): every included file must reach 80% on all four metrics. Vitest's
        // perFile switch applies the top-level numbers to each file rather than to the
        // aggregate, so there is no separate global floor. Do not lower these and do not
        // exclude files to pass them; add tests instead.
        perFile: true,
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
        // #36: the field mapper is the single point of failure for wire-to-client
        // naming, so it is held to 100%, not the per-file 80.
        "src/services/api/http/mappers.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
