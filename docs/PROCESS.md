# Development Process

Work is tracked as GitHub Issues with labels — no project boards. Six role agents handle the lifecycle. An orchestrator (the top-level session, human supervising) drives it and does no role work itself.

Project facts and the binding engineering rules live in `AGENTS.md`. This document is only the pipeline.

Issue `#N` is backlog task `N`, for all 49. New intake takes the next free number and gets no phase label.

## Lifecycle

```
Issue  →  PM grooms          →  Engineer builds  →  Tester verifies  →  PM accepts  →  Merge
          (criteria + tests)     (code + tests)      (runs suites)       (user POV)     (local, no PR)
```

1. **Issue exists.** The 49 backlog issues already do. Anything else — a bug, a change of mind, a gap found mid-work — the orchestrator files with `needs grooming`. It never grooms inline.
2. **PM grooms.** Backlog issues have scope settled by the spec, so grooming adds only acceptance criteria, test scenarios, dependencies and labels. Intake issues get scope too.
3. **Engineer implements** — code and tests, locally, no commit.
4. **Tester** runs the suites and verifies every criterion. PASS or FAIL.
5. **PM accepts** from the user's perspective: flow, copy, empty/loading/error states, accessibility, spec consistency.
6. **Engineer commits** on the worktree branch; the orchestrator merges and pushes.
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

Definitions live in `.agents/` — plain Markdown with a `name` and a `description` and no harness-specific configuration. `.claude/agents` is a symlink to it so Claude Code discovers them automatically; point any other harness at `.agents/` directly. If symlinks are unavailable, read `.agents/` directly.

Nothing here pins a model or a tool list. Each role needs:

| Role | File access | Reasoning |
| --- | --- | --- |
| `product-manager` | read/write — issue bodies, not code | strongest available |
| `designer` | read-only | standard |
| all others | read/write | standard |

Use the strongest model available for grooming and acceptance, where misreading the spec is expensive. A standard model is fine for implementation, testing and CI triage. Map these onto whatever your harness calls them.

### Routing

| Issue touches | Agent |
| --- | --- |
| `src/` or `apps/web/`, Vite, bun, Vitest, Playwright, shadcn | `web-engineer` |
| `apps/api/`, FastAPI, SQLAlchemy, Alembic, pytest, the LLM, Docker | `api-engineer` |
| The contract — OpenAPI schema, field mapper, mock-to-HTTP swap | `api-engineer` first (schema is the source of truth), then `web-engineer` |

The `web`, `api`, `ai`, `contract` and `infra` labels on every backlog issue give the routing without opening it. Issues #34–36 are the only ones routinely needing both engineers — sequence them, never concurrently.

## Orchestrator

- It manages: files intake issues, dispatches agents, relays handoffs, merges, keeps the pipeline full. It does not groom, write feature code, run suites, or accept.
- File intake immediately, with a concrete reproduction or quoted context. Do not wait for the user to file it.
- Launch agents non-blocking unless the result blocks the next action.
- Cap three active agents; two when more than one will run a suite.
- Before dispatching into a worktree, `main` must be clean — worktrees branch from `HEAD`, so uncommitted work is invisible to the agent and conflicts on merge.
- Respect dependencies: API issues need #1, `apps/web/` paths need #7, database writes need #21 and #22, LLM calls need #37.
- Route failures: code and test failures back to the engineer, CI and infrastructure failures to on-call.

## Merging — local only, no PRs

Never `gh pr create` or `gh pr merge`. The agent flow *is* the review.

After the engineer commits on `agent/issue-N`, from the main checkout:

```bash
git fetch origin && git status          # clean, and HEAD == origin/main
git merge --no-ff agent/issue-N -m "Merge agent/issue-N: <subject> (#N)"
git push origin main
```

`(#N)` is the issue number; there are no PR numbers. The engineer's commit body carries `Closes #N`, so the push auto-closes it. Then dispatch on-call if CI exists.

## Worktrees

Parallel engineers need isolation or they overwrite each other.

- One worktree per issue, created from the main checkout. A single sequential agent can use the main checkout instead. Some harnesses can create the worktree for you; the result must be the same.
  ```bash
  git worktree add .worktrees/issue-N -b agent/issue-N
  ```
- After the merge is pushed and on-call is green, from the main checkout:
  ```bash
  git worktree remove .worktrees/issue-N && git branch -d agent/issue-N
  ```
  No `--force`, no recursive delete — a refusal means something is still using it or the branch is unmerged, and that is information.
- Never remove a worktree while a role that can reach it is running, and never let an agent remove its own.

## Never skipped

- Every issue goes through every stage, including "simple" ones.
- No commit without a tester PASS.
- Agents post their own issue comments and tick their own acceptance-criteria checkboxes.
- The tester runs the suites; a verdict with no commands behind it is not a verdict.
- Every commit references an issue: `Closes #N`, or `Refs #N` when a `[HUMAN]` criterion keeps it open.
- A red pipeline is never "flaky" or "pre-existing". Find the commit range, read `--log-failed`, fix the root cause. Setting a failure aside requires proving it unrelated *and* filing an issue.

## Human verification

Mark criteria no agent can check as `[HUMAN]` during grooming. Planora has several: a TLS certificate seen from outside the host (#46), real mobile browsers (#49), a restore actually executed (#45).

When such an issue passes agent review: merge and push, add the `human` label, comment listing exactly what needs checking and how, leave the issue open, move on.

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

Skip `needs grooming`. Prefer the lowest-numbered groomed, unblocked issue — the backlog is ordered deliberately, and Phase 1 establishes the toolchain everything else builds on. #2 and #3 carry the main technical risk (the Vite reconstruction and the lockfile regeneration) and are sequenced before the file moves on purpose; do not reorder them behind #7.

Two independent issues may run in parallel when they touch different tiers.

## Release gate

Spec section 17 lists 25 acceptance criteria; #49 verifies them against the deployed stack. An issue is done when its own criteria pass. The release is done when all 25 do.

Four are cross-cutting and worth re-checking whenever work comes near them: **16** the mock swap changes no page component, **21** regenerating OpenAPI types yields no diff, **24** a Done task never renders overdue, **25** no third-party build or telemetry service anywhere in the dependency tree, served HTML, or runtime.
