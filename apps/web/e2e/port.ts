import { createServer } from "node:net";

/**
 * Asks the OS for a currently-free TCP port on the given host by binding to
 * port 0, reading back the port the kernel assigned, then releasing it.
 *
 * Playwright's `webServer.command` and `webServer.url` are plain strings
 * built once when the config loads, so the port has to be known before the
 * config object exists — hence a small async helper awaited at module scope
 * rather than something resolved lazily inside `webServer`.
 *
 * Each `bun run e2e` invocation therefore gets its own port instead of the
 * previously hard-coded 4173. That is what makes concurrent runs (parallel
 * worktrees, or one running next to a manual `bun run dev`) independent:
 * nobody reuses, and nobody can be shut out of, another run's server.
 */
export function getFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not determine a free port: no address assigned"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
