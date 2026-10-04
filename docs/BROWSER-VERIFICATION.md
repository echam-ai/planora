# Agent-Driven Browser Verification

Read this only when an issue reaches step 2 or 3 of the **browser evidence ladder** in `docs/PROCESS.md`, meaning it needs a text snapshot or a screenshot that the committed Playwright specs cannot provide. A refactor, API, database, deployment or documentation change never needs it.

**Prefer a spec over a session.** If a check is worth making, it is usually worth keeping. Add it to `apps/web/e2e/` as a Playwright Test assertion (`getByRole`, `toHaveText`, `toMatchAriaSnapshot`) and run it with `bun run e2e -- <file>`. That path uses Playwright's bundled Chromium, which is installed and works on this host. It checks desktop and mobile in one run and leaves a regression test behind. Delete a throwaway spec before handoff if it should not be committed.

**Known host limitation (checked 2026-09-24).** `@playwright/cli` 0.1.21 cannot start a browser here. Its default `chrome` channel is not installed (`/opt/google/chrome/chrome` is missing). A `chromium` config fails because the CLI expects a different Chromium build from the one Playwright Test installed. Do not spend a verification run debugging this. Use a spec. Retry the CLI only if a newer version is adopted through its own issue.

When you do use the CLI or a browser tool, the rule still holds: record the required capability, the attempted command, what you saw and the evidence it produced. A failed first selector is not a capability limitation. If no tool verifies a criterion, leave it unverified — a fallback never turns missing evidence into a pass.

## Setup

The repository evaluated `@playwright/cli` 0.1.21. Invoke it transiently through Bun. Do not use npm/npx, install it globally, add it to `package.json`, or change `bun.lock`.

Shell functions and environment variables do **not** survive between agent tool calls, so write a launcher script once and call it by path afterwards. Start from the assigned worktree root so this works both before and after #7.

```bash
repo_root="$(git rev-parse --show-toplevel)"
work="$repo_root/.tmp/playwright-cli/issue-N-role"
mkdir -p "$work" "$repo_root/.tmp/playwright-cli-cache"

cat > "$repo_root/.tmp/pwcli" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$work"
# An agent tool call may start a shell without ~/.bun/bin on PATH.
bun_bin="\$(command -v bun || echo "\$HOME/.bun/bin/bun")"
BUN_INSTALL_CACHE_DIR="$repo_root/.tmp/playwright-cli-cache" \\
  exec "\$bun_bin" x --package @playwright/cli@0.1.21 playwright-cli -s="issue-N-role" "\$@"
EOF
chmod +x "$repo_root/.tmp/pwcli"

.tmp/pwcli --version   # expect 0.1.21
.tmp/pwcli --help open
```

Read the installed version's help before relying on syntax; the CLI is evolving. Keep the cache, profile and evidence under `.tmp/`. Never reassign `HOME` or `CODEX_HOME`. Use a unique issue/role session name so parallel agents do not share browser state.

For a flow that needs login state across commands, open the installed stable Chrome with a task-local profile:

```bash
.tmp/pwcli open "$url" --browser=chrome --profile="$work/profile"
```

## Unlock first

Every route sits behind the shared site password (#124). A fresh browser session lands on `/login`; unlock before any flow:

- **Mock mode** (`VITE_API_MODE=mock`, the default): the demo password is `focusboard`, shown on the page when `DEMO_UI_ENABLED`.
- **HTTP mode** (`VITE_API_MODE=http`, `scripts/run-local.sh`): type the `APP_PASSWORD` from `apps/api/.env`. Never paste it into an issue comment or evidence file. Keep wrong attempts well under five per client IP in 15 minutes, or the API answers `429 RATE_LIMITED`.

After unlocking, `/` shows the account chooser; **Lock** in the account menu signs out again. The access cookie lasts 30 days, so a task-local browser profile stays unlocked across commands until `APP_PASSWORD` or `SESSION_SECRET` changes.

## Evidence loop

```bash
# Bounded page state, then identify the intended target.
.tmp/pwcli snapshot --depth=4
.tmp/pwcli find "Unlock"

# Refs from the current output are valid for the next action only.
.tmp/pwcli fill e13 "focusboard"   # mock mode; in HTTP mode type APP_PASSWORD, never paste it into evidence
.tmp/pwcli click e16

# A state change invalidates old refs — locate the result to get fresh ones.
.tmp/pwcli find "Active tasks"
.tmp/pwcli snapshot main --depth=5

# Only when appearance is the point (ladder step 3): capture both viewports, then read each PNG.
.tmp/pwcli resize 1280 720
.tmp/pwcli screenshot --filename="$work/board-desktop.png"
.tmp/pwcli resize 390 844
.tmp/pwcli screenshot --filename="$work/task-mobile.png"

# Diagnostics. Silence is an observation worth recording.
.tmp/pwcli console warning
.tmp/pwcli requests             # API calls and failures; successful static assets hidden
.tmp/pwcli requests --static    # include successful scripts, styles, fonts, images
.tmp/pwcli request N            # inspect one request's status and response

.tmp/pwcli close                # always, when the walkthrough is done
```

Choose `N` from the applicable list and inspect that specific request. A long request list is not a substitute for checking the one result that matters.

Prefer `find`, an element snapshot or a depth-limited snapshot over repeated full-page dumps. Keep console and request excerpts brief. Capture a screenshot only for ladder step 3, and only of the changed screen. Read every screenshot you save and record what is visibly present — creating a PNG is not visual verification. Wait for the loaded state first; the mock API adds 250–600 ms of latency, and a skeleton capture has to be taken again.

## Drag and drop

Refresh the snapshot and establish unique source and destination targets before acting, then verify the card's resulting column/status and its persistence across a reload.

The evaluation's naive drag resolved the destination back to the source and left the card in place. That is failure evidence, not a successful drag and not proof the CLI lacks the capability. A precise `run-code` interaction is acceptable after checking its installed help. A visible status control may verify a status-change criterion, but it cannot prove a drag-and-drop criterion. Report exactly which behavior was exercised.

## What the 0.1.21 trial actually confirmed

Named-session login, current snapshot refs, fill/click navigation, targeted `find`, desktop/mobile resizing and screenshots, zero warning/error console output, and exact static-resource request inspection returning HTTP 200.

The help also exposes drag/drop, `run-code`, tracing, video, storage-state and device-emulation commands. The trial did not exercise all of them — do not report them as trial successes.
