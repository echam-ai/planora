import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { assertValidApiMode } from "./src/services/api/apiMode";

export default defineConfig(({ command, mode }) => {
  // Fails `vite build`/`vite dev` immediately on an invalid or mistyped
  // VITE_API_MODE (e.g. "HTTP"), instead of only throwing later at runtime
  // when services/api/index.ts first loads in the browser — a bad value
  // must not ship as a production build that silently breaks every page
  // (issue #35, PM rejection on the first pass). `loadEnv` reads both
  // process.env and any .env files, matching what services/api/index.ts
  // sees via `import.meta.env` at runtime.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  assertValidApiMode(env["VITE_API_MODE"]);

  return {
    plugins: [
      mode === "development" && devtools(),
      tanstackStart({
        // Keep the existing SSR error wrapper as TanStack Start's server entry.
        server: { entry: "server" },
      }),
      viteReact(),
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      command === "build" && nitro({ preset: "node-server" }),
    ],
    server: {
      proxy: {
        // Dev-only: makes HTTP mode (VITE_API_MODE=http) work from one origin
        // locally, ahead of #43's same-origin Caddy routing in production.
        // The target is read from a non-VITE_ variable so `vite build` never
        // inlines it into the client bundle (only Vite's own Node process
        // sees it). changeOrigin is false so the browser's Origin (the dev
        // server's) reaches the API unchanged — set the API's APP_ORIGIN to
        // that origin (e.g. http://localhost:5173).
        "/api": {
          target: process.env["PLANORA_API_PROXY_TARGET"] ?? "http://127.0.0.1:8000",
          changeOrigin: false,
        },
      },
    },
  };
});
