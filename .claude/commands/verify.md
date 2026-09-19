---
description: Run the stage-appropriate checks for the current work and report evidence
---

Run the verification that this project's current stage actually supports, and report what you ran — not what you assume passes.

## 1. Establish where you are

```bash
git rev-parse --show-toplevel && git branch --show-current
ls apps/web/src 2>/dev/null || ls src     # web root: repo root before #7, apps/web after
git status --short --untracked-files=all
```

## 2. Pick the checks

From `docs/PROCESS.md` → **Verification by project stage**. Match the row to what actually changed, not to the issue title.

- Documentation / agent configuration only → diffs, links and paths, role frontmatter, symlink targets, and a walkthrough of each affected workflow. No application launch, no coverage.
- Web, before #8/#9 → `bun run lint`, `bunx tsc --noEmit`, `bun run build`, plus targeted observable checks. Vitest is unavailable until #8, E2E until #9 — say so, do not build them.
- Web, once harnesses exist → `bun run test`, `bun run test:coverage` (≥80%), `bun run lint`, `bunx tsc --noEmit`, `bun run build`, relevant `bun run e2e`.
- API (from `apps/api`) → `uv run pytest --cov --cov-fail-under=80` and `uv run ruff check .`.
- Migrations, from #22 → `uv run alembic upgrade head` against disposable empty databases, on SQLite and PostgreSQL.

A visible change also needs desktop and mobile screenshots — follow `docs/BROWSER-VERIFICATION.md` and **read each PNG**. Creating a file is not looking at it.

## 3. Report

One line per check: command, cwd, result, test count, coverage. For anything unavailable, name the reason and the owning milestone. Never claim an unrun check passed, and never report a missing check that this change should have introduced as a bootstrap exemption — that is a failure to resolve.

Close with the verdict and, if it is a FAIL, the file, line, what happens and what should happen instead.
