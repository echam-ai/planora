# Development Process

Work is tracked as GitHub Issues with labels — no project boards, no pull requests. Role agents handle the lifecycle; an orchestrator (the top-level session, human supervising) drives it and does no role work itself.

Project facts and the binding engineering rules live in `AGENTS.md`. This document is only the pipeline.

Original issues #1–#49 map to tasks 1–49 in `docs/tasks.md`. Later issues are intake; GitHub assigns their numbers and they get no phase label. README cleanup is intake #50.

## Lanes

Not every issue earns the same ceremony. Pick the lane from what the issue touches, and say which lane you picked in the first handoff.

| Lane | Applies to | Pipeline |
| --- | --- | --- |
| **Full** | A change the user can observe — features, bug fixes, copy, layout, deadline or other business rules — plus the API contract, persisted data/migrations, security and deployment | PM grooms → engineer → tester → PM accepts → orchestrator commits and merges |
| **Light** | Behavior-preserving refactors (moves, splits, renames, extractions) proven by the existing suites; documentation, agent/role definitions, harness, process, CI, lint/format config | Orchestrator writes criteria on the issue → engineer → tester → orchestrator commits and merges |
| **Direct** | A typo, a dead link, a stale sentence in a doc — no behavior, no configuration | Orchestrator edits, commits, merges. No dispatch. |

The lane follows **what the user could notice**, not which directory changes. A refactor qualifies for the light lane only when it changes no observable behavior, weakens or deletes no test assertion, and the existing unit and e2e suites cover the moved code. A PM acceptance review of an unchanged screen checks nothing, so it is skipped. The tester gate is never skipped.

If light-lane work turns out to change behavior, copy, the contract or configuration an application depends on, stop and re-run it as full lane. Escalate when in doubt; never quietly downgrade — state the lane and the reason in the first handoff.

## Lifecycle

```
Issue  →  PM grooms          →  Engineer builds  →  Tester verifies  →  PM accepts  →  Merge
          (criteria + tests)     (code + tests)      (runs suites)       (user POV)     (local, no PR)
```

1. **Issue exists.** Anything not already filed — a bug, a change of mind, a gap found mid-work — the orchestrator files with `needs grooming`. It never grooms inline on the full lane.
2. **PM grooms** (full lane). Backlog scope is settled by the spec, so grooming adds acceptance criteria, test scenarios, dependencies and labels. Intake issues get scope too.
3. **Engineer implements** — code and tests, locally, no commit.
4. **Tester** runs the applicable checks below and verifies every automated criterion. PASS or FAIL.
5. **PM accepts** (full lane) from the user's perspective: flow, copy, empty/loading/error states, accessibility, spec consistency.
6. **Orchestrator commits** the reviewed state on the issue branch, using the subject the engineer proposed in its handoff, only after the lane's gates cover that exact state; then it merges and pushes. Re-dispatching an engineer only to run `git commit` costs a cold agent start and adds no review.
7. **On-call** observes CI. Dormant until #10 creates the workflow.

## Agents

| Agent | Role |
| --- | --- |
| `product-manager` | Grooming (start) and user acceptance review (end) |
| `web-engineer` | TanStack Start / React / TypeScript, plus process and configuration issues |
| `api-engineer` | FastAPI / SQLAlchemy / Python / deployment |
| `tester` | Runs the suites, verifies criteria, PASS/FAIL |
| `designer` | Audits UI against the spec; reports only |
| `oncall-engineer` | Sole CI observer after push |

Definitions live in `.agents/` — the single source of role policy. Both tracked harness paths, `.claude/agents` and `.codex/agents`, are symlinks to `../.agents` and expose the same six files. Edit roles only in `.agents/`; keep no copies and no per-role adapters.

- **Claude Code** registers these natively through the symlink; check `/agents` in a fresh session. `.claude/` also holds Claude-only plumbing (permissions, slash commands) that the shared files deliberately do not mention — see `CLAUDE.md`.
- **Codex** shares the same path, but a Markdown symlink does not register Codex custom roles. Use explicit dispatch.
- **Explicit dispatch (Codex, or Claude fallback):** spawn a generic subagent with: `Act as {role}. Work only in {absolute worktree cwd}. Before acting, read AGENTS.md, docs/PROCESS.md and .agents/{role}.md there, then handle issue #{N} in mode {implement|verify|groom|accept|audit|observe}.` Include the handoff fields below. Pointing a harness at a directory does not load role policy — have the agent acknowledge its cwd and role file before work. If subagents are unavailable, report that limitation; never replace independent review with self-approval.

Shared roles do not override host models, tools, permissions or sandbox settings. See the [Claude subagent format](https://code.claude.com/docs/en/sub-agents), [Claude instruction import](https://code.claude.com/docs/en/memory#agentsmd), and [Codex subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents).

Nothing here pins a model or a tool list — those are harness vocabulary and belong in harness-specific configuration, not in `.agents/`. Each role needs:

| Role | File access | Reasoning |
| --- | --- | --- |
| `product-manager` | read/write — issue bodies, not code | strongest available |
| `designer` | read-only application source; may save screenshots under `.tmp/` | strongest available |
| all others | read/write | standard |

Use the strongest available model for grooming, acceptance and design audits, where misreading the spec is expensive; a standard model is fine for implementation, testing and CI triage. Map these onto whatever your harness calls them — Claude Code's mapping is in `CLAUDE.md`.

### Routing

| Issue touches | Agent |
| --- | --- |
| `src/` or `apps/web/`, Vite, bun, Vitest, Playwright, shadcn | `web-engineer` |
| `apps/api/`, FastAPI, SQLAlchemy, Alembic, pytest, the LLM, Docker | `api-engineer` |
| The contract — OpenAPI schema, field mapper, mock-to-HTTP swap | `api-engineer` first (schema is the source of truth), then `web-engineer` |
| Process, shared role definitions, harness setup, general documentation | `web-engineer` unless API/deployment expertise is needed |

The `web`, `api`, `ai`, `contract` and `infra` labels give the routing without opening the issue. #34–36 are the only ones routinely needing both engineers — sequence them, never concurrently.

## Orchestrator

- It manages: files intake issues, picks the lane, dispatches agents, relays handoffs, commits reviewed states, merges, keeps the pipeline full. On the full lane it does not groom, write feature code, run suites, or accept.
- File intake immediately, with a concrete reproduction or quoted context. Do not wait for the user to ask.
- Launch agents non-blocking unless the result blocks the next action. Continue an agent that still holds the context (Claude `SendMessage`, a Codex follow-up) instead of spawning a fresh one for the same role and issue — for example, return a FAIL to the engineer who wrote the code.
- Cap three active agents. Serialize suites on the host: at most one `bun run e2e` runs at a time, and no other suite (`bun run verify`, `vitest`, `pytest`) overlaps it. `verify`/`vitest` and `pytest` may still overlap each other. Before an e2e run, `pgrep -fa '[p]laywright|[v]itest|[p]ytest' | grep -v "$PWD"` must print nothing; processes from other projects count. An e2e run that overlapped another suite is **void**: it counts as neither a pass nor a failure and is repeated in an exclusive window. The e2e suite is stable on a quiet host (230/230 at `--repeat-each=5`) and fails only under shared load ([#84](https://github.com/hgiang/planora/issues/84#issuecomment-5891442727)).
- Before creating a worktree, verify the main checkout is clean, on `main`, and synchronized with `origin/main`; record the base SHA. Preserve unrelated user edits and report any conflict rather than resetting them.
- Respect dependencies: API issues need #1, `apps/web/` paths need #7, database writes need #21 and #22, LLM calls need #37.
- Route failures: code and test failures back to the engineer, CI and infrastructure failures to on-call.

## Handoffs and review state

A handoff is **git state, not copied files.** Every engineering, testing and acceptance handoff carries exactly this:

```
issue:    #N            lane: full | light
cwd:      /absolute/path/to/worktree
branch:   agent/issue-N
base:     <base SHA>    head: <HEAD SHA, or "uncommitted">
commands: <each command, cwd, result, test count, coverage>
pending:  <[HUMAN] criteria, or none>
commit:   <proposed "<type>: <subject>" — engineer handoffs only>
```

Reviewers reproduce the state from that, in the given cwd:

```bash
git status --short --untracked-files=all
git diff <base-SHA> HEAD             # committed branch changes
git diff --cached                    # staged, including git mv
git diff                             # unstaged
git ls-files --others --exclude-standard
```

Read each untracked file — it appears in no diff above. Report ignored artifacts only when they are the deliverable, never credentials or dependency directories.

**Never copy a worktree, a `node_modules`, a `.venv` or a tarball into `.tmp/` as a review artifact.** Those copies cost minutes each and gigabytes, and `git diff` already carries the information. `.tmp/` is for browser evidence, screenshots and scratch — nothing that git can reproduce.

Before commit, confirm the staged content matches what the lane's reviewers approved. Any later deliverable edit, changed base, or conflict resolution invalidates affected verification and acceptance: return the resulting state to the tester (and PM, on the full lane) before commit/merge/push. A verdict for an earlier state is not approval of a later one.

## Verification by project stage

Select checks from actual files, scripts and issue scope. Record each command, cwd, result, test count and coverage. For an unavailable or not-applicable check, state the reason and the owning milestone; never claim an unrun check passed. A missing check that should already exist, or that the issue introduces, is a failure to resolve, not a bootstrap exemption.

| Work | Required verification |
| --- | --- |
| Documentation and agent configuration only | Diff/whitespace checks, links and paths, role frontmatter and symlink targets, discovery where supported, and a walkthrough of each affected workflow. No application launch, coverage, or new harness. |
| Web application | `bun run verify` from `apps/web` — coverage run (it runs every Vitest test and enforces the coverage ratchet toward 80% defined in `vitest.config.ts`), lint, typecheck and build in one command. `bun run e2e` whenever routes, components, hooks, the API client or browser flows change. Browser evidence beyond that follows the evidence ladder below. Use package scripts, not Bun's built-in test runner. |
| API | `uv run pytest --cov --cov-fail-under=80` and `uv run ruff check .`; affected health/startup and integration checks. |
| Database/migration work from #22 | Apply the history to disposable empty databases with `uv run alembic upgrade head`; verify affected upgrades and SQLite/PostgreSQL compatibility. Never point verification at production data. |

Run web commands from `apps/web` and API commands from `apps/api`. Tests precede implementation for application changes. An issue creating a harness (#22) verifies its new commands in that same issue. Build/runtime configuration changes use their tier's checks — the documentation row is not a waiver for executable configuration. Cross-contract changes verify both tiers and check OpenAPI type drift. Launch only the affected services.

**Run each gate once per role, on the final state.** While iterating, run targeted tests (`bun run test -- path`, `uv run pytest tests/x`). The engineer runs the full gate once before handing off and the tester runs it once independently. Re-run only what a later edit invalidates. A second run of an identical state is not more evidence.

**Comparing against the base** — to show a warning or failure pre-exists, run the same command in the main checkout, which sits at the base SHA. Never `git stash` in a worktree: the stash stack is shared by every worktree and session.

### Browser evidence ladder

Screenshots are the most expensive evidence an agent can collect. Each image costs thousands of tokens to read, and capturing one needs a running server, a browser session and waits for loading. Climb only as high as the change requires:

1. **Committed Playwright specs are the evidence.** `bun run e2e` runs every flow on desktop (`chromium`) and mobile (`mobile-chromium`). For new or changed visible behavior, add or extend a spec that asserts roles, labels and visible text. Those assertions cover the deadline text and icons, the confirmation dialogs and empty states. The spec then keeps covering that behavior as a regression test.
2. **Text snapshots for anything a spec cannot express.** An accessibility snapshot (`expect(locator).toMatchAriaSnapshot()` in a spec, or `snapshot`/`find` in the CLI) records structure, names and copy as a few hundred tokens of text.
3. **Screenshots only when appearance is the point.** Capture them when the issue changes layout, color, spacing or responsive behavior, or when a spec fails and its failure screenshot needs reading. Capture only the screens that changed, one per viewport. Only the tester captures and reads them. The PM and designer reuse the tester's files under `.tmp/screenshots/` instead of recapturing.

A behavior-preserving refactor, API work, or documentation stops at step 1 and needs no ad hoc browser session. For steps 2 and 3 outside a spec, follow **`docs/BROWSER-VERIFICATION.md`**. Read it only when you actually reach those steps.

## Merging — local only, no PRs

Never `gh pr create` or `gh pr merge`. The agent flow *is* the review. (Both are denied in `.claude/settings.json` so the rule is enforced, not merely stated.)

Commit the reviewed state in the issue worktree, with the engineer's proposed subject and no attribution trailer (binding rule 11):

```bash
git -C .worktrees/issue-N add -A && git -C .worktrees/issue-N diff --cached --stat   # matches the reviewed state
git -C .worktrees/issue-N commit -m "<type>: <subject>" -m "Closes #N"
```

Then, from the main checkout:

```bash
git fetch origin && git status          # clean, and HEAD == origin/main
git merge --no-ff agent/issue-N -m "Merge agent/issue-N: <subject> (#N)"
git push origin main
```

`(#N)` is the issue number; there are no PR numbers. The commit body carries `Closes #N`, so the push auto-closes it. Use `Refs #N` instead for pending `[HUMAN]` work or a CI repair. Then dispatch on-call if CI exists.

Before merging, confirm the lane's verdicts cover the committed state. If main advanced, return the integrated result for affected verification and acceptance; do not resolve conflicts and push under stale verdicts. On-call repairs follow this same pipeline and are merged and pushed only by the orchestrator.

## Worktrees

Parallel engineers need isolation or they overwrite each other.

- One worktree per issue, from the clean synchronized main checkout. Some harnesses create it for you; the result must be the same.
  ```bash
  git worktree add .worktrees/issue-N -b agent/issue-N
  ```
- A single sequential agent may instead use the main checkout after `git switch -c agent/issue-N`. Never implement or commit on `main`. After review and commit, switch back to `main` for the merge.
- After the merge is pushed, all roles have finished and on-call is green, remove an isolated worktree from the main checkout. Before #10, record that no CI workflow exists and rely on the lane's verdicts; unavailable CI does not block cleanup. Once CI exists, a missing run is not this exemption.
  ```bash
  git worktree remove .worktrees/issue-N && git branch -d agent/issue-N
  ```
  No `--force`, no recursive delete — a refusal means something is still using it or the branch is unmerged, and that is information.
- Never remove a worktree while a role that can reach it is running, and never let an agent remove its own.

## Never skipped

- Every issue goes through its lane's stages, including "simple" ones. The lane may be small; it is never absent.
- No commit without an independent tester PASS for the final reviewed state — and PM ACCEPTED as well on the full lane.
- Agents post their own issue comments and tick their own acceptance-criteria checkboxes.
- A verdict with no commands behind it is not a verdict.
- Every commit references an issue: `Closes #N`, or `Refs #N` when a `[HUMAN]` criterion keeps it open.
- A red pipeline is never "flaky" or "pre-existing". Find the commit range, read `--log-failed`, fix the root cause. Setting a failure aside requires proving it unrelated *and* filing an issue.

## Human verification

Mark criteria no agent can check as `[HUMAN]` during grooming. Planora has several: a TLS certificate seen from outside the host (#46), real mobile browsers (#49), a restore actually executed (#45).

When such an issue passes review: merge and push, add the `human` label, comment listing exactly what needs checking and how, leave the issue open, move on.

Tester PASS and PM ACCEPTED are permitted with only explicitly marked `[HUMAN]` criteria pending, provided every automated criterion passes. Keep those checkboxes unchecked, use `Refs #N`, and include the exact remaining checks in both handoffs. Never relabel a failed automated check as `[HUMAN]` to bypass a gate.

#48 force-pushes over `origin/main` and is irreversible. No agent runs it — the orchestrator asks the user at the time, and prior approval does not carry.

## Labels

| Category | Labels |
| --- | --- |
| Workflow | `needs grooming` |
| Phase | `phase-1-foundations` … `phase-7-deployment` |
| Area | `web`, `api`, `ai`, `contract`, `infra`, `documentation` |
| Priority | `P0` blocks v1, `P1` in v1, `P2` optional |
| Special | `human` — code done, needs manual verification |

Backlog issues carry one phase and one area label, and no priority. Intake issues carry an area and a priority, and no phase.

## Picking issues

```bash
gh issue list --repo hgiang/planora --state open --limit 60 \
  --json number,title,labels \
  --jq 'sort_by(.number) | .[] | "#\(.number) \(.title) [\(.labels|map(.name)|join(", "))]"'
```

Read candidate bodies with `gh issue view N --repo hgiang/planora`. Ready means substantive `Acceptance Criteria` checkboxes, executable `Test Scenarios`, explicit `Dependencies` (including `none`), correct labels, and no `needs grooming`. An absent label alone is not readiness. If a section is missing or placeholder-only, groom before implementation; if no ready issue exists, groom the lowest-numbered otherwise unblocked candidate. Do not bulk rewrite backlog scope.

Prefer the lowest-numbered ready, unblocked issue — the backlog is ordered deliberately, and Phase 1 establishes the toolchain everything else builds on. #2 and #3 carry the main technical risk and are sequenced before the file moves on purpose; do not reorder them behind #7.

No `phase-7-deployment` issue is picked while any open issue in phases 1–6, or any open `P0`/`P1` intake issue, remains: local macOS usability in HTTP mode comes before deployment. `P2` intake does not block phase 7. Lowest-numbered first is still the tie-break within each group.

Two independent issues may run in parallel when they touch different tiers; their suites still follow the serialization rule in **Orchestrator**, so an e2e run waits for any active `pytest` or `vitest`.

## Release gate

Spec section 17 lists 25 acceptance criteria; #49 verifies them against the deployed stack. An issue is done when its own criteria pass. The release is done when all 25 do.

Four are cross-cutting and worth re-checking whenever work comes near them: **16** the mock swap changes no page component, **21** regenerating OpenAPI types yields no diff, **24** a Done task never renders overdue, **25** no third-party build or telemetry service anywhere in the dependency tree, served HTML, or runtime.
