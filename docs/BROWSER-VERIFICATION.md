# Agent-Driven Browser Verification

Read this only when an issue needs a browser: UI screenshots, a visual audit, or an observable check that nothing else can make. API, database, deployment and documentation work never needs it.

Playwright CLI is the default tool for local browser exploration. Named sessions, reference-based actions and targeted snapshots give durable evidence at far less context cost than a browser MCP. Once #9 exists, committed Playwright Test flows through `bun run e2e` remain the authoritative regression gate; a CLI walkthrough complements it and never replaces it.

Host tool availability and permissions still govern execution. Use Chrome MCP or another browser tool only when Playwright CLI cannot exercise a capability the criterion requires, after a real CLI attempt. Record the required capability, the attempted command, the observation, the chosen fallback and the resulting evidence. A failed first selector or an ambiguous target is not a capability limitation. If no tool verifies a criterion, leave it unverified — a fallback never turns missing evidence into a pass.

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

## Evidence loop

```bash
# Bounded page state, then identify the intended target.
.tmp/pwcli snapshot --depth=4
.tmp/pwcli find "Sign in"

# Refs from the current output are valid for the next action only.
.tmp/pwcli fill e13 "demo"
.tmp/pwcli click e16

# A state change invalidates old refs — locate the result to get fresh ones.
.tmp/pwcli find "Active tasks"
.tmp/pwcli snapshot main --depth=5

# Capture both viewports to named files, then read each PNG.
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

Prefer `find`, an element snapshot or a depth-limited snapshot over repeated full-page dumps. Keep console and request excerpts brief. **Read every saved screenshot with the host's image viewer** and record what is visibly present — creating a PNG is not visual verification.

## Drag and drop

Refresh the snapshot and establish unique source and destination targets before acting, then verify the card's resulting column/status and its persistence across a reload.

The evaluation's naive drag resolved the destination back to the source and left the card in place. That is failure evidence, not a successful drag and not proof the CLI lacks the capability. A precise `run-code` interaction is acceptable after checking its installed help. A visible status control may verify a status-change criterion, but it cannot prove a drag-and-drop criterion. Report exactly which behavior was exercised.

## What the 0.1.21 trial actually confirmed

Named-session login, current snapshot refs, fill/click navigation, targeted `find`, desktop/mobile resizing and screenshots, zero warning/error console output, and exact static-resource request inspection returning HTTP 200.

The help also exposes drag/drop, `run-code`, tracing, video, storage-state and device-emulation commands. The trial did not exercise all of them — do not report them as trial successes.
