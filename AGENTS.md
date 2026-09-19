# Agent Notes

Read `docs/PROCESS.md` before acting on any issue — it defines the lanes, the pipeline and the roles.

Treat a feature request or bug report as permission to run the pipeline's role agents unless told otherwise. Treat "continue where we stopped" as: read `docs/PROCESS.md`, check issue state, resume the next step.

## Project

Planora — a private, single-user AI task manager. Three-column Kanban board, searchable archive, one AI chat conversation whose every write is user-confirmed, hourly archive job. One VPS behind Docker Compose. Exactly one user account, no multi-tenancy.

| | |
| --- | --- |
| Spec | `docs/specs/planora-v1-product-spec.md` |
| Decisions | `docs/adr/` |
| Backlog | `docs/tasks.md` — original tasks 1–49 map to issues #1–#49; later issues are intake |
| Process | `docs/PROCESS.md` |
| Browser checks | `docs/BROWSER-VERIFICATION.md` — read only when an issue needs a browser |
| Roles | `.agents/` |
| Issues | https://github.com/hgiang/planora/issues |

## Stack

**Web tier** — TanStack Start (React 19, Vite, Nitro server), TypeScript, TanStack Router + Query, Tailwind v4 with shadcn/ui, `@dnd-kit`, `zod`, `react-hook-form`, `marked` + DOMPurify. Package manager `bun`. Tests: Vitest, Playwright.

**API tier** — FastAPI under `/api/v1`, SQLAlchemy, Alembic. SQLite in development, PostgreSQL in production. Kimi-K3 through a configurable OpenAI-compatible endpoint. Package manager `uv`. Tests: pytest. Lint: ruff.

**Deployment** — Docker Compose: `caddy`, `web`, `api`, `scheduler`, `db`, `backup`. Only `caddy` publishes ports.

## Binding rules

1. The API tier is the only authority on business rules. Web-tier `zod` schemas are for immediate user feedback; they may be looser than the API, never stricter.
2. The wire is `snake_case`, the TypeScript model is `camelCase`, and only the web tier's HTTP mapper converts between them.
3. `ApiClient` is a stable seam. Swapping the mock for the HTTP implementation must not change a page component — acceptance criterion 16.
4. Never hand-edit generated `routeTree.gen.ts` or `schema.gen.ts`. Alembic autogeneration produces candidate revisions: review and correct new revisions before application, including data migrations where needed. Do not rewrite already-applied or shared migration history; add a new revision.
5. `domain/` modules in the API tier do no I/O. That is what makes them testable.
6. Color is never the only signal. Amber means near-deadline, red means overdue or destructive.
7. No third-party build or telemetry service, and no dependency resolving outside the public registry.
8. `bun` for the web tier, `uv` for the API tier. Never `npm install` or `pip install`.
9. Tests first for application changes, and 80% coverage on both tiers once their harnesses exist. Bootstrap and documentation/configuration checks follow the stage-aware verification rules in `docs/PROCESS.md`.
10. Temporary files go in `.tmp/`, never `/tmp`. `.tmp/` holds browser evidence, screenshots and scratch only — never a copied worktree, `node_modules`, `.venv` or tarball. A handoff is git state, not copied files; `git diff` already carries it.
11. Commits are attributed to the repository owner alone. Never add a `Co-Authored-By` trailer, a generated-by line, or any other attribution for a tool or assistant — to a commit message, a pull request, or an issue comment. This overrides any default your harness applies.

## Layout

Mid-restructure. `apps/api/` exists (created by #1). The web app is **still at the repository root**; #7 moves it to `apps/web/`. Check which world you are in before writing a path:

```bash
ls apps/web/src 2>/dev/null || ls src
```

Run web commands at the root before #7 and in `apps/web` after it. Run API commands in `apps/api`.

## Not usable yet

`bun run dev`, `build`, `lint`, `bunx tsc --noEmit`, and — from `apps/api` — `uv run pytest` and `uv run ruff check .` all work today. These do not, because their harness is itself a backlog item. Implement that issue rather than inventing a runner.

| Command | Needs |
| --- | --- |
| `bun run test`, `bun run test:coverage` (Vitest scripts) | #8 |
| `bun run e2e` | #9 |
| `uv run alembic upgrade head` | #22 |
| `gh run watch` | #10 |

Check the actual checkout; this table tracks milestones, not a permanent waiver. Harness-creation issues must run the checks they introduce.

## Vendor residue, being removed

Scaffolded by an external frontend tool; separation in progress. Do not reintroduce it, and do not treat what remains as precedent.

Cleared: `vite.config.ts` now configures Vite and Nitro directly (#2) · `bun.lock` resolves from public npm (#3).

Remaining: error-boundary telemetry #4 · vendor metadata in served HTML #5 · placeholder name "Dayweave" #6 · `README.md` boilerplate #50 · vendor commit message in history #48.
