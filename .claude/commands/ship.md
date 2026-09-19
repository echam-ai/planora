---
description: Merge a reviewed issue branch into main, push, and clean up
argument-hint: <issue number>
---

Merge issue #$1. Orchestrator-only — no agent runs this.

## 1. Confirm the gates cover the committed state

The lane decides which verdicts are required: full lane needs tester PASS **and** PM ACCEPTED; light lane needs tester PASS. Both must cite the commit you are about to merge, not an earlier state. If anything was edited after a verdict, stop and return it for re-verification.

## 2. Merge from the main checkout

```bash
git fetch origin && git status          # clean, and HEAD == origin/main
git merge --no-ff agent/issue-$1 -m "Merge agent/issue-$1: <subject> (#$1)"
git push origin main
```

Never `gh pr create` or `gh pr merge` — denied in `.claude/settings.json`, and the agent flow is the review. If `main` advanced, return the integrated result for affected verification before pushing; do not resolve conflicts under stale verdicts.

## 3. Pending human checks

If the commit used `Refs #$1`, the issue stays open: add the `human` label and comment with exactly what needs checking and how.

## 4. On-call

Dispatch `oncall-engineer` with the merge SHA once #10 exists. Before then, record explicitly that no CI workflow exists.

## 5. Clean up

Only after every role has finished and on-call is green:

```bash
git worktree remove .worktrees/issue-$1 && git branch -d agent/issue-$1
```

No `--force`, no recursive delete. A refusal means something is still using it or the branch is unmerged — that is information, not an obstacle.

Also remove that issue's scratch from `.tmp/`; it is git-ignored but it accumulates.

Report the merge SHA, the issue state, and whether any `[HUMAN]` check is outstanding.
