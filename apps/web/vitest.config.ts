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
        // routing and auth tests, #79's server entry and error-handling tests, and #104's
        // TaskForm tests), not the 80% target in AGENTS.md rule 9. It may only be raised,
        // never lowered. No file is known to be below 80% per file now; the tier-wide per-file
        // switch is #109. perFile is intentionally unset for files not listed below: the floor
        // is an aggregate over the whole include set, not a per-file check, until #109 lands.
        statements: 98,
        branches: 95,
        functions: 98,
        lines: 99,
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
        "src/lib/markdown-html.ts": {
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
        // #77: settings.
        "src/routes/settings.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/features/settings/hooks.ts": {
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
        // #104: task form.
        "src/features/tasks/components/TaskForm.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // #76: chat.
        "src/features/chat/components/ChatPanel.tsx": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/features/chat/hooks.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        "src/services/api/mock/chat.ts": {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
