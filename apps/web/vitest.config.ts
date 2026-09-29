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
        // Ratchet (#71): global floor is the measured baseline (raised again by #78's shell,
        // routing and auth tests, and #79's server entry and error-handling tests), not the
        // 80% target in AGENTS.md rule 9. It may only be raised, never lowered. Files below
        // 80% per file today, grouped by follow-up issue that raises them and the global floor:
        //   Chat (ChatPanel.tsx, features/chat/hooks.ts, services/api/mock/chat.ts) -> #76
        //   Settings (routes/settings.tsx, features/settings/hooks.ts)          -> #77
        // The last follow-up ends the ratchet at 80% per file across the tier. perFile is
        // intentionally unset for files not yet listed below: the floor below is an aggregate
        // over the whole include set, not a per-file check, until every follow-up lands.
        statements: 88,
        branches: 82,
        functions: 83,
        lines: 88,
        // Per-file guarantees, unaffected by the ratchet above.
        "src/features/tasks/deadline.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/lib/markdown.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // #75: board and task detail components.
        "src/features/tasks/components/Board.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/features/tasks/components/CreateTaskDialog.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/features/tasks/components/BoardFilters.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/features/tasks/components/TaskDetailSheet.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/features/tasks/components/BoardColumn.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // #78: shell, routing and auth.
        "src/components/layout/AppShell.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/hooks/use-mobile.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/hooks/useAuthGuard.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/routes/__root.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/routes/index.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/routes/login.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/routes/tasks.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/router.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // #79: server entry and error handling.
        "src/server.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/start.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/lib/error-capture.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/lib/error-page.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/lib/root-error-reporting.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // #35: the HTTP ApiClient implementation and its build-time selection.
        "src/services/api/index.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/services/api/apiMode.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/services/api/http/client.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // #36: the field mapper is the single point of failure for wire-to-client
        // naming, so it is held to 100% statement and branch coverage, not the ratchet.
        "src/services/api/http/mappers.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "src/services/api/http/httpApiClient.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
