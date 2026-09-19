# Development Process

Work is tracked as GitHub Issues with labels — no project boards. Six role agents handle the lifecycle. An orchestrator (the top-level session, human supervising) drives it and does no role work itself.

Project facts and the binding engineering rules live in `AGENTS.md`. This document is only the pipeline.

Original issues #1–#49 map to tasks 1–49 in `docs/tasks.md`. Later issues are intake, not additional numbered tasks in that document; GitHub assigns their numbers. Intake gets no phase label. README cleanup is intake #50.

## Lifecycle

```
Issue  →  PM grooms          →  Engineer builds  →  Tester verifies  →  PM accepts  →  Merge
          (criteria + tests)     (code + tests)      (runs suites)       (user POV)     (local, no PR)
```

1. **Issue exists.** The 49 backlog issues already do. Anything else — a bug, a change of mind, a gap found mid-work — the orchestrator files with `needs grooming`. It never grooms inline.
2. **PM grooms.** Backlog issues have scope settled by the spec, so grooming adds only acceptance criteria, test scenarios, dependencies and labels. Intake issues get scope too.
3. **Engineer implements** — code and tests, locally, no commit.
4. **Tester** runs applicable verification below and verifies every automated criterion. PASS or FAIL.
5. **PM accepts** from the user's perspective: flow, copy, empty/loading/error states, accessibility, spec consistency.
6. **Engineer commits** on the issue branch only after tester PASS and PM ACCEPTED for the final reviewed state; the orchestrator merges and pushes.
7. **On-call** observes CI. Dormant until #10 creates the workflow.

## Agents

| Agent | Role |
| --- | --- |
| `product-manager` | Grooming (start) and user acceptance review (end) |
| `web-engineer` | TanStack Start / React / TypeScript |
| `api-engineer` | FastAPI / SQLAlchemy / Python / deployment |
| `tester` | Runs the suites, verifies criteria, PASS/FAIL |
| `designer` | Audits UI against the spec; reports only |
| `oncall-engineer` | Sole CI observer after push |

Definitions live in `.agents/` — the single source of role policy, in Markdown with `name` and `description` frontmatter. Both tracked harness paths, `.claude/agents` and `.codex/agents`, are symlinks to `../.agents` and expose the same six files. Edit roles only in `.agents/`; do not maintain copies or per-role adapters.

- **Claude Code:** `CLAUDE.md` imports `AGENTS.md`; the tracked `.claude/agents -> ../.agents` symlink exposes all six roles. In a fresh session, check `/agents` for their names. Preserve the symlink rather than copying role files.
- **Codex:** `.codex/agents -> ../.agents` provides the same shared path structure as Claude. This Markdown symlink does not natively register Codex custom roles; there are no TOML wrappers. The orchestrator must use the explicit generic-subagent dispatch below.
- **Explicit dispatch (Codex, or Claude fallback):** spawn a generic subagent with the instruction: `Act as {role}. Work only in {absolute worktree cwd}. Before acting, read AGENTS.md, docs/PROCESS.md and .agents/{role}.md there, then handle issue #{N} in mode {implement|verify|groom|accept|audit|observe}.` Include the handoff fields below. Merely pointing a harness at a directory does not load role policy. Have the agent acknowledge its cwd and role file before work. If symlinks are unavailable, use the canonical `.agents/` paths directly. If subagents themselves are unavailable, report that limitation; do not replace independent review with self-approval.

Shared roles do not override host models, tools, permissions or sandbox settings. Host permissions still apply. See the official [Claude subagent format](https://code.claude.com/docs/en/sub-agents), [Claude instruction import](https://code.claude.com/docs/en/memory#agentsmd), and [Codex subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents).

Nothing here pins a model or a tool list. Each role needs:

| Role | File access | Reasoning |
| --- | --- | --- |
| `product-manager` | read/write — issue bodies, not code | strongest available |
| `designer` | read-only application source; may save screenshots under `.tmp/` | standard |
| all others | read/write | standard |

Use the strongest model available for grooming and acceptance, where misreading the spec is expensive. A standard model is fine for implementation, testing and CI triage. Map these onto whatever your harness calls them.

### Routing

| Issue touches | Agent |
| --- | --- |
| `src/` or `apps/web/`, Vite, bun, Vitest, Playwright, shadcn | `web-engineer` |
| `apps/api/`, FastAPI, SQLAlchemy, Alembic, pytest, the LLM, Docker | `api-engineer` |
| The contract — OpenAPI schema, field mapper, mock-to-HTTP swap | `api-engineer` first (schema is the source of truth), then `web-engineer` |
| Process, shared role definitions, harness setup, general documentation | `web-engineer` unless API/deployment expertise is needed |

The `web`, `api`, `ai`, `contract` and `infra` labels on every backlog issue give the routing without opening it. Issues #34–36 are the only ones routinely needing both engineers — sequence them, never concurrently.

## Orchestrator

- It manages: files intake issues, dispatches agents, relays handoffs, merges, keeps the pipeline full. It does not groom, write feature code, run suites, or accept.
- File intake immediately, with a concrete reproduction or quoted context. Do not wait for the user to file it.
- Launch agents non-blocking unless the result blocks the next action.
- Cap three active agents; two when more than one will run a suite.
- Before creating a worktree, verify the main checkout is clean, on `main`, and synchronized with `origin/main`; record the base SHA. Preserve unrelated user edits and report any conflict rather than resetting them.
- Respect dependencies: API issues need #1, `apps/web/` paths need #7, database writes need #21 and #22, LLM calls need #37.
- Route failures: code and test failures back to the engineer, CI and infrastructure failures to on-call.

## Handoffs and review state

Every engineering, testing and acceptance handoff includes issue number, absolute worktree cwd, branch, base SHA, changed-file list, commands/results, pending `[HUMAN]` criteria, and an identifiable review artifact/state. Record `HEAD` plus a patch for tracked changes and a content-hash manifest for all changed/new files (including paths and deletions); store artifacts under the worktree's `.tmp/`. Do not include secrets or unrelated ignored files. Tester and PM cite the same state in their verdicts.

Review all change surfaces from that cwd, using the supplied base SHA:

```bash
git status --short --untracked-files=all
git diff <base-SHA> HEAD             # committed branch changes
git diff --cached                   # staged changes, including git mv
git diff                            # unstaged changes
git ls-files --others --exclude-standard
```

Read each relevant untracked file as well; it is absent from every diff above. Inventory ignored artifacts if they are part of the deliverable, not credentials or dependency directories. Before commit, confirm the staged content matches what both reviewers approved. Any subsequent deliverable edit, changed base, or integration conflict resolution invalidates affected verification and acceptance: return the resulting state to tester and PM before commit/merge/push. A verdict for an earlier patch is not approval of a later patch.

## Verification by project stage

Select checks from actual files/scripts and issue scope, not just issue closure. Record each command, cwd, result, test count and coverage where applicable. For unavailable or not-applicable checks, state the reason and owning milestone; never claim an unrun check passed. A missing check that should already exist, or that the issue introduces, is a failure to resolve, not a bootstrap exemption.

| Work | Required verification |
| --- | --- |
| Documentation and agent configuration only | Diff/whitespace checks, links/paths, role/frontmatter and symlink targets, discovery where supported, and walkthroughs of affected workflows. No application launch, application test coverage or new application harness is required. Record discovery limitations and verify explicit role dispatch. |
| Web bootstrap before #8/#9 | Existing lint, TypeScript and build checks; targeted observable checks for the change. Record Vitest/coverage unavailable until #8 and E2E unavailable until #9. #2–#7 must not implement those future harnesses just to pass review. |
| Web application once harnesses exist | `bun run test`, `bun run test:coverage` (at least 80%), `bun run lint`, `bunx tsc --noEmit`, `bun run build`; relevant `bun run e2e` flows after #9, plus inspected desktop/mobile screenshots for visible changes. Use package scripts, not Bun's built-in test runner. |
| API from #1 | `uv run pytest --cov --cov-fail-under=80` and `uv run ruff check .`; affected API health/startup and integration checks. #1 establishes/runs its test harness but does not require migrations from #22. |
| Database/migration work from #22 | Apply migration history to disposable empty databases using `uv run alembic upgrade head`, verify affected upgrades and SQLite/PostgreSQL compatibility. Never point verification at production data. |

Run web commands from the worktree root before #7, or `apps/web` after it; run API commands from `apps/api`. Inspect package scripts/configuration before choosing the command. Tests precede application implementation once the relevant harness exists. An issue creating a harness (#1, #8, #9, #22) must verify its newly introduced commands in that same issue. Build/runtime configuration changes use their affected tier's checks; the documentation-only row is not a waiver for executable application configuration. Cross-contract changes verify both tiers and regenerate/check OpenAPI type drift. Launch only the affected services; API-only work does not require a web server and documentation-only work requires neither.

### Agent-driven browser verification

Use the official [Playwright CLI](https://github.com/microsoft/playwright-cli) by default for local browser exploration, screenshots and ad hoc verification. Its named sessions, reference-based actions, targeted snapshots and `find`, console and request inspection, screenshots and viewport emulation provide durable browser evidence with less model-context overhead than a browser MCP. This default applies before #9 as a stage-appropriate observable check; it does not require creating the future E2E harness. Once #9 exists, committed Playwright Test flows through relevant `bun run e2e` commands remain the authoritative regression gate. A successful CLI walkthrough complements that gate and never replaces it or any other check in the table above.

Host tool availability and permissions still govern browser execution. Use Chrome MCP or another available browser tool only when Playwright CLI cannot exercise a capability required by the criterion after a reasonable CLI attempt. Record the required capability, attempted command and observation, chosen fallback and resulting evidence. A failed first selector or ambiguous target is not a capability limitation. If no available tool verifies the criterion, leave it unverified; a fallback never turns missing evidence into a pass.

The repository evaluated `@playwright/cli` 0.1.21. Invoke it transiently through Bun; do not use npm/npx, install it globally, add it to `package.json` or change `bun.lock`. Start from the assigned worktree root so the pattern remains valid both before and after #7:

```bash
repo_root="$(git rev-parse --show-toplevel)"
pwcli_cache="$repo_root/.tmp/playwright-cli-cache"
pwcli_work="$repo_root/.tmp/playwright-cli/issue-N-role"
pwcli_session="issue-N-role"
mkdir -p "$pwcli_cache" "$pwcli_work"
cd "$pwcli_work"

pwcli() {
  BUN_INSTALL_CACHE_DIR="$pwcli_cache" \
    bun x --package @playwright/cli@0.1.21 playwright-cli "$@"
}

pwcli --version
pwcli --help
pwcli --help open
```

The version command should report `0.1.21`. Read the installed version's help before relying on syntax because the CLI is evolving. The repository-local Bun cache above, the task working directory, explicit profile and named output paths keep task-created caches and browser evidence under `.tmp/`; do not reassign `HOME` or `CODEX_HOME`. Use a unique issue/role session name so parallel agents do not share state. Open the installed stable Chrome channel and keep its profile task-local when the flow needs login state across commands:

```bash
pwcli -s="$pwcli_session" open "$url" \
  --browser=chrome \
  --profile="$pwcli_work/profile"
```

Use this evidence loop, adapting accessible names and refs to the page under test:

```bash
# Obtain current, bounded page state and identify the intended target.
pwcli -s="$pwcli_session" snapshot --depth=4
pwcli -s="$pwcli_session" find "Sign in"

# Use refs from the current output for the next action only.
pwcli -s="$pwcli_session" fill e13 "demo"
pwcli -s="$pwcli_session" fill e15 "dayweave"
pwcli -s="$pwcli_session" click e16

# A state change invalidates old refs: locate the result and get fresh refs.
pwcli -s="$pwcli_session" find "Active tasks"
pwcli -s="$pwcli_session" snapshot main --depth=5

# Capture both viewports to named task-local files, then visually read each PNG.
pwcli -s="$pwcli_session" resize 1280 720
pwcli -s="$pwcli_session" screenshot \
  --filename="$pwcli_work/board-desktop.png"
pwcli -s="$pwcli_session" resize 390 844
pwcli -s="$pwcli_session" screenshot \
  --filename="$pwcli_work/task-mobile.png"

# Check browser diagnostics explicitly; silence is an observation to record.
pwcli -s="$pwcli_session" console warning
# Ordinary API calls and failed resources; successful static assets are omitted.
pwcli -s="$pwcli_session" requests
# Include successful scripts, styles, fonts and images when one is the evidence.
pwcli -s="$pwcli_session" requests --static
pwcli -s="$pwcli_session" request N

# Always stop the named browser when the walkthrough is complete.
pwcli -s="$pwcli_session" close
```

Use plain `requests` for ordinary API diagnostics and failures. Version 0.1.21 hides successful static resources by default, so use `requests --static` when a successful script, stylesheet, font or image is the evidence. Choose `N` from the applicable list, run `request N`, and inspect that request's status and response details. Do not substitute a long request list for checking the specific result. Read saved screenshots with the host's image viewer and record what is visibly present; creating a PNG is not visual verification.

Prefer `find`, an element snapshot, or a depth-limited snapshot over repeated full-page dumps. Use current unique accessible targets, keep console/request excerpts brief, and save named evidence under the task directory. Retain enough surrounding state to establish the actual outcome. The evaluated trial confirmed named-session login, current snapshot refs, fill/click navigation, targeted `find`, desktop/mobile resizing and screenshots, zero warning/error console output, and exact static-resource request inspection with HTTP 200 responses. Its saved evidence is under `.tmp/playwright-cli-eval/`. The 0.1.21 help also exposes drag/drop, `run-code`, tracing, video, storage-state and device-emulation commands; those capabilities were not all exercised by that trial, so do not report them as trial successes.

For drag and drop, refresh the snapshot and establish unique source and destination targets before acting, then verify the card's resulting column/status and reload persistence when required. The evaluation's naive drag resolved the destination back to the source and left the card in place; it is failure evidence, not a successful drag or proof that CLI lacks the capability. A precise `run-code` interaction is acceptable after checking its installed help. A visible status control may verify a status-change criterion, but it cannot prove a drag-and-drop criterion. Report exactly which behavior was exercised.

## Merging — local only, no PRs

Never `gh pr create` or `gh pr merge`. The agent flow *is* the review.

After the engineer commits on `agent/issue-N`, from the main checkout:

```bash
git fetch origin && git status          # clean, and HEAD == origin/main
git merge --no-ff agent/issue-N -m "Merge agent/issue-N: <subject> (#N)"
git push origin main
```

`(#N)` is the issue number; there are no PR numbers. The engineer's commit body carries `Closes #N`, so the push auto-closes it. Then dispatch on-call if CI exists.

Use `Refs #N` instead for pending `[HUMAN]` work or a CI repair. Before merging, confirm both verdicts cover the committed state. If main advanced, return the integrated result for affected verification and acceptance; do not resolve conflicts and push under stale verdicts. On-call repair work follows this same pipeline and is merged/pushed only by the orchestrator.

## Worktrees

Parallel engineers need isolation or they overwrite each other.

- One worktree per issue, created from the clean synchronized main checkout. Some harnesses can create the worktree for you; the result must be the same.
  ```bash
  git worktree add .worktrees/issue-N -b agent/issue-N
  ```
- A single sequential agent may instead use the main checkout after creating `agent/issue-N` with `git switch -c agent/issue-N`. Never implement or commit on `main`. After review and commit, switch back to `main` for the orchestrator's merge; branch cleanup needs no worktree removal in this case.
- After the merge is pushed, all roles have finished, and on-call is green, remove an isolated worktree from the main checkout. Before #10, explicitly record that no CI workflow exists and rely on tester PASS plus PM ACCEPTED; unavailable CI does not block cleanup. Once CI exists, a missing run is not this exemption. Confirm the worktree is clean and the branch merged first:
  ```bash
  git worktree remove .worktrees/issue-N && git branch -d agent/issue-N
  ```
  No `--force`, no recursive delete — a refusal means something is still using it or the branch is unmerged, and that is information.
- Never remove a worktree while a role that can reach it is running, and never let an agent remove its own.

## Never skipped

- Every issue goes through every stage, including "simple" ones.
- No commit without independent tester PASS and PM ACCEPTED for the final reviewed state.
- Agents post their own issue comments and tick their own acceptance-criteria checkboxes.
- The tester runs applicable stage-aware checks; a verdict with no commands behind it is not a verdict.
- Every commit references an issue: `Closes #N`, or `Refs #N` when a `[HUMAN]` criterion keeps it open.
- A red pipeline is never "flaky" or "pre-existing". Find the commit range, read `--log-failed`, fix the root cause. Setting a failure aside requires proving it unrelated *and* filing an issue.

## Human verification

Mark criteria no agent can check as `[HUMAN]` during grooming. Planora has several: a TLS certificate seen from outside the host (#46), real mobile browsers (#49), a restore actually executed (#45).

When such an issue passes agent review: merge and push, add the `human` label, comment listing exactly what needs checking and how, leave the issue open, move on.

Tester PASS and PM ACCEPTED are permitted with only explicitly marked `[HUMAN]` criteria pending, provided every automated criterion passes. Keep those human checkboxes unchecked, use `Refs #N` in the commit, and include the exact remaining checks and instructions in both handoffs. Never relabel a failed automated check as `[HUMAN]` to bypass a gate.

#48 force-pushes over `origin/main` and is irreversible. No agent runs it — the orchestrator asks the user at the time, and prior approval does not carry.

## Labels

| Category | Labels |
| --- | --- |
| Workflow | `needs grooming` |
| Phase | `phase-1-foundations` … `phase-7-deployment` |
| Area | `web`, `api`, `ai`, `contract`, `infra`, `documentation` |
| Priority | `P0` blocks v1, `P1` in v1, `P2` optional |
| Special | `human` — code done, needs manual verification |

Backlog issues carry one phase and one area label, and no priority — they are all in v1 and the phase is their ordering. Intake issues carry an area and a priority, and no phase.

## Picking issues

```bash
gh issue list --repo hgiang/planora --state open --limit 60 \
  --json number,title,labels \
  --jq 'sort_by(.number) | .[] | "#\(.number) \(.title) [\(.labels|map(.name)|join(", "))]"'
```

Read candidate bodies with `gh issue view N --repo hgiang/planora`. Ready means substantive `Acceptance Criteria` checkboxes, executable/observable `Test Scenarios`, explicit `Dependencies` (including `none`), correct labels, and no `needs grooming` label. An absent label alone is not readiness. If any section is missing or placeholder-only, dispatch PM grooming before implementation; if no ready issue exists, groom the lowest-numbered otherwise unblocked candidate. Do not bulk rewrite backlog scope.

Prefer the lowest-numbered ready, unblocked issue — the backlog is ordered deliberately, and Phase 1 establishes the toolchain everything else builds on. #2 and #3 carry the main technical risk (the Vite reconstruction and the lockfile regeneration) and are sequenced before the file moves on purpose; do not reorder them behind #7.

Two independent issues may run in parallel when they touch different tiers.

## Release gate

Spec section 17 lists 25 acceptance criteria; #49 verifies them against the deployed stack. An issue is done when its own criteria pass. The release is done when all 25 do.

Four are cross-cutting and worth re-checking whenever work comes near them: **16** the mock swap changes no page component, **21** regenerating OpenAPI types yields no diff, **24** a Done task never renders overdue, **25** no third-party build or telemetry service anywhere in the dependency tree, served HTML, or runtime.
