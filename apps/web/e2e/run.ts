import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";

import { getFreePort } from "./port";

/**
 * Wraps `playwright test` to pick this run's webServer port exactly once,
 * before Playwright starts (#66), and to forward termination signals to it.
 *
 * `playwright.config.ts` is loaded independently by Playwright's main
 * process and by every worker process it forks. Picking a free port inside
 * the config itself therefore picks a *different* port in each of those
 * loads — the config can't tell them apart — leaving workers pointed at a
 * server nobody started. Picking the port once here and passing it down as
 * environment variables (which every forked worker inherits) keeps the
 * whole run, main process and workers alike, agreeing on one port.
 *
 * This script — not Playwright — is now the process an agent shell, a CI
 * step, or a supervisor tracks and signals, so it must relay termination to
 * the child and wait for it to exit before exiting itself. `child_process
 * .spawn` (not `spawnSync`) is required for that: a synchronous wait blocks
 * the event loop, so a signal handler registered around a `spawnSync` call
 * would not run until *after* the blocking call already returned, by which
 * point forwarding is too late.
 *
 * Whatever signal arrives here (SIGINT, SIGTERM or SIGHUP), the child is
 * always sent SIGINT: Playwright's CLI runner registers a graceful-
 * shutdown handler only for SIGINT (see `FixedNodeSIGINTHandler` in
 * `playwright/lib/runner/index.js`) and tears its webServer down as part
 * of that handler. It has no equivalent SIGTERM/SIGHUP handler, so relaying
 * those as-is kills the `playwright test` process outright — confirmed by
 * sending SIGTERM directly to a bare `playwright test` process and finding
 * its `vite dev` child still running and holding its port afterwards, vs.
 * SIGINT to the same process tearing both down within well under a second.
 */
const host = "127.0.0.1";
const port = await getFreePort(host);

const child = spawn("playwright", ["test", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYWRIGHT_WEB_HOST: host,
    PLAYWRIGHT_WEB_PORT: String(port),
  },
});

const terminationSignals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

for (const signal of terminationSignals) {
  process.on(signal, () => {
    child.kill("SIGINT");
  });
}

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    // The child was killed by a signal rather than exiting on its own — exit
    // with the conventional 128+n code instead of re-sending the signal to
    // ourselves, since our own signal handlers above have already run.
    const signalNumber: number | undefined = (osConstants.signals as Record<string, number>)[
      signal
    ];
    process.exit(128 + (signalNumber ?? 0));
  }
  process.exit(code ?? 1);
});
