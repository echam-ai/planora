import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command, mode }) => ({
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
}));
