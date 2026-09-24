---
description: Run the pipeline for one issue, from lane selection through commit
argument-hint: <issue number>
---

Run the pipeline for issue #$1. You are the orchestrator: you dispatch, relay and merge. On the full lane you do not groom, write feature code, run suites, or accept.

**Read `docs/PROCESS.md` first.** These steps assume it.

## 1. Lane and readiness

`gh issue view $1 --repo hgiang/planora`. Pick the lane (Lanes table). State it out loud before dispatching — it decides how many agents run.

- **Full** — anything the user could observe, plus the contract, data, security, deployment. Needs PM grooming, then engineer, tester, PM acceptance.
- **Light** — behavior-preserving refactors covered by existing suites; docs, roles, harness or process config. You write three to six acceptance criteria onto the issue yourself, then engineer and tester only.
- **Direct** — a typo or dead link. Do it yourself, commit, merge, stop.

## 2. Isolation

Verify the main checkout is clean, on `main`, synchronized with `origin/main`. Record the base SHA — every handoff carries it.

```bash
git worktree add .worktrees/issue-$1 -b agent/issue-$1
```

A single sequential agent may instead use the main checkout after `git switch -c agent/issue-$1`. Never work on `main`.

## 3. Dispatch

Route with the Routing table. Pass the model override from the table in `CLAUDE.md` — `opus` for `product-manager` and `designer`, `sonnet` for the engineers, `tester` and `oncall-engineer`. Give each agent the handoff block from `docs/PROCESS.md`:

```
issue:    #$1           lane: <full|light>
cwd:      <absolute worktree path>
branch:   agent/issue-$1
base:     <base SHA>    head: <HEAD SHA or "uncommitted">
commands: <each command, cwd, result, counts, coverage>
pending:  <[HUMAN] criteria, or none>
```

Handoffs are git state. Never ask for, accept, or create a copied worktree, `node_modules`, `.venv` or tarball as a review artifact.

Sequence: engineer → tester → (full lane) product-manager. Route a FAIL or REJECTED back to the **same** engineer with `SendMessage` — it still holds the context — then re-run the gates it invalidated. Tell the tester which rung of the browser evidence ladder applies (`docs/PROCESS.md`), so no screenshots are taken for a change nobody can see. A verdict for an earlier state is not approval of a later one.

## 4. Commit and merge

You commit on `agent/issue-$1` once the lane's gates cover the final state, using the engineer's proposed subject — `Closes #$1`, or `Refs #$1` if a `[HUMAN]` criterion keeps it open. Check `git diff --cached --stat` against the reviewed state first. No attribution trailers (binding rule 11).

Then merge with `/ship $1`.

Report at each stage transition in a few lines: what ran, the verdict, what is next. Do not narrate tool output.
