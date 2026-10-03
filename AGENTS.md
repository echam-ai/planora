# Agent Notes

Read `docs/PROCESS.md` before acting on any issue — it defines the lanes, the pipeline and the roles.

Treat a feature request or bug report as permission to run the pipeline's role agents unless told otherwise. Treat "continue where we stopped" as: read `docs/PROCESS.md`, check issue state, resume the next step.

## Project

Planora — a private AI task manager with two fixed unauthenticated profiles, Hamster Knight and Ech Princess. Each has independent tasks, board order, searchable archive, one AI conversation whose every write is user-confirmed, timezone and model preferences. A no-login chooser selects the profile; anyone who can reach the app may choose either. Active and archived tasks support irreversible confirmed permanent deletion. One VPS behind Docker Compose; hourly archival handles both profiles.

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

Monorepo. The web app lives in `apps/web/` (moved there from the repository root by #7); the API tier lives in `apps/api/` (created by #1). Run web commands in `apps/web`; run API commands in `apps/api`.

## Commands

From `apps/web`: `bun run verify` is the whole unit gate: every Vitest test with coverage enforced per file in `vitest.config.ts` (every included file must reach 80%; `mappers.ts` is held to 100%), then lint, typecheck and build. `bun run e2e` runs the Playwright flows on desktop and mobile. `bun run test -- <path>` is for iterating. From `apps/api`: `uv run pytest --cov --cov-fail-under=80` and `uv run ruff check .`. `uv run alembic upgrade head` applies the existing migration history to a disposable verification database.

`bun` lives in `~/.bun/bin`, which a non-interactive agent shell may not have on `PATH`. If `bun` is not found, prefix the command with `PATH="$HOME/.bun/bin:$PATH"` rather than hunting for it. A fresh worktree needs `bun install --frozen-lockfile` in `apps/web` before its first web check; never copy dependencies between checkouts. All local suites follow the shared host lock protocol in `docs/PROCESS.md`.

After any API contract change, regenerate the web tier's wire types with `bun run gen:api-types` (from `apps/web`) — it runs `openapi-typescript` against the committed `../api/openapi.json` and writes `src/shared/api/schema.gen.ts`, a types-only file that must never be hand-edited (binding rule 4). The order is: export `apps/api/openapi.json` (`uv run python -m planora_api.openapi`), then generate `schema.gen.ts`, then commit both files together. CI enforces both steps independently — the `api` job re-exports and diffs `openapi.json`, the `web` job regenerates and diffs `schema.gen.ts` — so a forgotten regeneration fails the build instead of surfacing at runtime.

`VITE_API_MODE` (`apps/web/.env.example`) selects the `ApiClient` implementation at build time: `http` for the real FastAPI backend, `mock` (the default when unset) for sample data in browser storage. Any other value, including wrong case (`HTTP`), fails `vite build` and `vite dev` immediately — `vite.config.ts` validates it via `src/services/api/apiMode.ts`'s `assertValidApiMode`, naming the variable and its allowed values; `services/api/index.ts` repeats the same check at runtime as a backstop. Production (#42/#43) must build with `VITE_API_MODE=http`. `PLANORA_API_PROXY_TARGET`, also documented there, points the dev server's `/api` proxy (`vite.config.ts`) at the API when running HTTP mode locally; it is never `VITE_`-prefixed, so it never reaches the client bundle.

## Vendor residue, being removed

Scaffolded by an external frontend tool; separation in progress. Do not reintroduce it, and do not treat what remains as precedent.

Cleared: `apps/web/vite.config.ts` now configures Vite and Nitro directly (#2) · `apps/web/bun.lock` resolves from public npm (#3).

Remaining: error-boundary telemetry #4 · vendor metadata in served HTML #5 · placeholder name "Dayweave" #6 · `README.md` boilerplate #50 · vendor commit message in history #48.
