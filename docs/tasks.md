# Planora — v1 Implementation Backlog

Each task is sized for a single session and written to stand alone: the
description names the files and facts you need without assuming you have read
any other task.

**Reference documents**

- Specification: `docs/specs/planora-v1-product-spec.md`
- Decisions: `docs/adr/0001-tech-stack.md`, `0002-api-and-naming-conventions.md`,
  `0003-repo-layout.md`

**Conventions that apply to every task**

- The API wire format is `snake_case`; the TypeScript domain model is
  `camelCase`. Conversion happens only in the web tier's HTTP mapper.
- The API tier is the only authority on business rules. Client-side validation
  exists for immediate feedback and may be looser, never stricter.
- Target layout is a monorepo: `apps/web`, `apps/api`, `docs/`, `deploy/`.
- Tests come first, and coverage must stay at or above 80% on both tiers.
- Commit messages follow `<type>: <description>`.

---

# Phase 1 — Foundations

## 1. Scaffold the API application with a passing test
Goal: Create `apps/api` as an empty FastAPI project whose test suite runs green.
Description: Add `pyproject.toml` declaring FastAPI, uvicorn, pytest, pytest-cov and ruff, then create the `planora_api` package with an application factory and a single `GET /api/v1/health` endpoint. Write one test asserting the health endpoint returns 200, and confirm `pytest` passes from a clean virtual environment. No database, no models, and no domain logic — this task exists to establish a green baseline everything else builds on.

## 2. Replace the vendored Vite configuration with explicit plugins
Goal: Own the web tier's build configuration in-repo and target Nitro's node-server preset.
Description: `vite.config.ts` currently delegates the entire build to a third-party configuration package that hides the plugin list and defaults Nitro to a Cloudflare target, which is wrong for a VPS deployment. Replace it with an explicit plugin list — TanStack devtools (development only, ordered first), `tanstackStart`, the React plugin, the Tailwind plugin, `vite-tsconfig-paths`, and Nitro with the `node-server` preset — and add those plugins as direct devDependencies. Do not reproduce the vendored package's error-logger plugins or its sandbox port detection; both exist only to serve an external editor preview. Verify with a clean install, a production build, and a lint pass.

## 3. Regenerate the lockfile against the public npm registry
Goal: Remove all third-party registry URLs from dependency resolution.
Description: `bun.lock` resolves `@dnd-kit/*`, `marked`, `dompurify` and `@types/trusted-types` from a vendor's private package cache, so every install, CI run and Docker build fetches tarballs from third-party infrastructure. Delete the lockfile and reinstall so every package resolves from the public registry, and remove the four vendor-specific exemptions from `bunfig.toml` while keeping its 24-hour minimum-release-age guard. This re-resolves every caret range in the manifest and is effectively a dependency upgrade — the manifest pins Vite exactly, depends on a beta Nitro release and overrides the bundler version, so expect breakage and verify with a build and a lint pass before finishing.

## 4. Remove vendor telemetry from the web application
Goal: Stop reporting runtime errors to a third-party service.
Description: `src/lib/lovable-error-reporting.ts` sends caught React errors, together with the current route path, to global hooks belonging to an external editor preview, and it is called from the root error boundary at `src/routes/__root.tsx`. Delete the module and replace the call site with local structured logging. Confirm afterwards that no `window.__lovable*` reference survives anywhere in the tree.

## 5. Replace vendor branding in the served HTML
Goal: Serve Planora's own document metadata instead of the scaffold's.
Description: The head block in `src/routes/__root.tsx` sets the document title to "Lovable App", the description and author to vendor strings, and `twitter:site` to a vendor handle — all of which appear in served HTML and in link previews. Replace them with Planora metadata and swap `public/favicon.ico` for the project's own icon. Revisit `public/robots.txt` in the same pass: it currently invites Googlebot, Bingbot, Twitterbot and facebookexternalhit, which is wrong for a private single-user application.

## 6. Rename the product to Planora across the web application
Goal: Replace every occurrence of the placeholder product name.
Description: The name "Dayweave" appears in the `APP_NAME` constant in `src/types/index.ts`, in page titles and meta descriptions across nine route and component files, in the `prose-dayweave` CSS classes in `src/styles.css`, in the `dayweave.*` localStorage keys in `src/services/api/mockApiClient.ts`, and as the mock client's `DEFAULT_PASSWORD`. Rename all of them, and set the mock password to something that is not the product name. Changing the storage keys resets local demo data, which is expected and harmless.

## 7. Move the web application into apps/web
Goal: Establish the monorepo layout recorded in ADR 0003.
Description: Move the frontend's root-level files — `src/`, `public/`, `package.json`, `vite.config.ts`, `tsconfig.json`, `components.json`, `eslint.config.js` and `bunfig.toml` — into `apps/web`, leaving `docs/` and `deploy/` at the repository root. Use `git mv` so the moves are recorded as renames, update any path assumptions inside the configs, and rename the package to `planora-web`. Verify that both the dev server and the production build still work from the new location.

## 8. Add the web tier unit test harness
Goal: Give the web application a green unit test suite with a coverage gate.
Description: Install and configure Vitest with a jsdom environment and React Testing Library, and set a coverage threshold of 80%. Write the first real unit tests against `lib/deadline.ts`, which is pure and whose behavior the specification pins down precisely — cover no deadline, more than 24 hours out, exactly 24 hours, and a past deadline. Add `test` and `test:coverage` scripts.

## 9. Add the end-to-end test harness
Goal: Drive the web application in a real browser against the mock API.
Description: Install Playwright and configure it to start the dev server and run against Chromium plus one mobile viewport, since the specification requires the application to work at both desktop and mobile widths. Write one end-to-end test that logs in with the mock credentials and asserts the board renders its three columns. Add an `e2e` script and confirm the report and result directories are git-ignored.

## 10. Add continuous integration
Goal: Run both applications' checks on every push.
Description: Add a GitHub Actions workflow with two independent jobs: one that installs the web tier and runs lint, typecheck, unit tests with the coverage gate and a production build; one that installs the API tier and runs ruff, pytest and its coverage gate. Keep the jobs independent so a failure in one still reports the result of the other.

---

# Phase 2 — Web reorganization

## 11. Prune unused UI components and their dependencies
Goal: Remove dead design-system code from the web tier.
Description: Thirty-three of the forty-six components in `src/components/ui` are imported nowhere outside that folder, including `sidebar.tsx` at 744 lines, `chart.tsx` at 331 and `carousel.tsx` at 240 — roughly 2,500 lines of dead code. Delete the unused ones and drop the six dependencies that only they used: recharts, embla-carousel-react, input-otp, react-resizable-panels, cmdk and vaul. Keep `calendar.tsx`, `popover.tsx` and `react-day-picker` even though they are currently unused: the timezone-aware date picker needs them. Verify with a typecheck and a production build.

## 12. Extract shared domain schemas
Goal: Define the task, chat, settings and session models once, as zod schemas.
Description: Validation schemas are currently declared inline inside `src/components/TaskForm.tsx` and `src/routes/login.tsx`, while the types live separately in `src/types/index.ts` — so there is no single definition of a valid task even within the frontend. Create `src/shared/domain/{task,chat,settings,session}.ts` holding zod schemas with the TypeScript types inferred from them rather than declared by hand, and update both components to import from there. Keep these schemas at or looser than what the API will enforce; they exist for immediate user feedback, not authority.

## 13. Move the ID generator out of mock fixtures
Goal: Stop a shipped component importing from dev-only seed data.
Description: `src/components/TaskForm.tsx` imports its `uid()` helper from `@/data/seed`, coupling production code to mock fixtures that should be removable. Move the generator to `src/lib/id.ts` and update every caller. This is one of the four divergences recorded in the specification's §12.3.

## 14. Split the mock API client by domain
Goal: Break the 644-line single-file mock into focused modules.
Description: `src/services/api/mockApiClient.ts` handles authentication, settings, task CRUD, ordering, archive, chat, natural-language parsing and localStorage persistence in one file. Split it into `mock/{auth,tasks,archive,chat,store,seed}.ts` with the shared storage helpers in `store.ts`, keeping both the exported `mockApiClient` object and the `ApiClient` interface in `src/services/api/ApiClient.ts` unchanged. This is a pure refactor — the existing UI must work untouched afterwards.

## 15. Reorganize components into feature modules
Goal: Group the web tier by domain instead of by file type.
Description: Move the seven top-level components in `src/components` into `src/features/{tasks,chat}/components`, leaving `AppShell.tsx` under `src/components/layout` and the design-system primitives where they are under `src/components/ui`. Move `lib/deadline.ts` into `features/tasks/` and split `hooks/useApi.ts` into per-feature `hooks.ts` files. Every import uses the `@/` path alias, so this is a mechanical move plus import updates; verify with a typecheck and the existing tests.

## 16. Reduce the board route to composition
Goal: Extract the board's logic out of a 310-line route file.
Description: `src/routes/tasks.tsx` currently holds the three-column layout, the filter state, the drag-and-drop wiring and the dialog orchestration all at once. Extract `Board`, `BoardColumn` and `BoardFilters` into `features/tasks/components`, leaving the route as a thin shell that renders them. Behavior must not change — this is preparation for the filter rework, which is far easier once the filter UI is its own component.

---

# Phase 3 — Specification conformance

## 17. Rebuild board filters as combinable multi-select
Goal: Satisfy the specification's §7.4 filter requirement.
Description: The board currently exposes one single-select control per dimension, held in state as `"all" | "due_soon" | "overdue" | "none"`, and the "Scheduled" deadline option is missing entirely. Rebuild the filters so category, priority and deadline state each accept zero or more values, combining with OR within a dimension and AND across dimensions, and add a clear-all action. Selecting nothing within a dimension must mean that dimension does not filter, and filtering must never change stored task order.

## 18. Add the Completed deadline state
Goal: Stop Done tasks being described by their deadline.
Description: `lib/deadline.ts` returns `scheduled` for a Done task whose deadline has passed, and the `DeadlineState` union has no `completed` member at all. Add the fifth state, make it take precedence over every other state whenever status is `done`, and give it its own text label and non-color indicator on both the card and the detail view. A Done task must never render as Scheduled, Near deadline or Overdue; note that the deadline filters deliberately offer only the other four states, so a Done task matches no deadline filter.

## 19. Make deadline entry timezone-aware
Goal: Interpret entered deadlines in the Settings timezone, not the browser's.
Description: The task form uses a native `datetime-local` input and converts with `new Date(value).toISOString()`, which resolves the entered wall-clock time in the browser's local zone and therefore violates the specification's §6.1 and §11. Replace it with a date picker plus a time field that converts using the timezone from Settings, adding `date-fns-tz` for the conversion. Verify that a deadline entered as a wall-clock time is stored as that instant in the Settings timezone, and remains the same instant after the Settings timezone is subsequently changed.

## 20. Harden and test Markdown rendering
Goal: Prove that user-supplied Markdown cannot execute script or unsafe HTML.
Description: `src/lib/markdown.tsx` renders notes by passing `marked` output through DOMPurify and into `dangerouslySetInnerHTML`, but nothing tests that the sanitization actually holds. Add unit tests covering inline `<script>` tags, `javascript:` URLs, event-handler attributes such as `onerror`, and `<iframe>` embeds, asserting each is neutralized rather than rendered. In the same pass, confirm that rendered links carry `target="_blank"` with `rel="noopener noreferrer"` as the specification's §8 requires. This is the specification's ninth acceptance criterion and the one place where a regression is a security bug rather than a cosmetic one.

---

# Phase 4 — API foundations

## 21. Add configuration with fail-fast secret validation
Goal: Load settings from the environment and refuse to start when a required secret is missing.
Description: Add a pydantic-settings configuration module covering the database URL, session secret, LLM base URL, LLM API key, model name, application origin and default timezone. Startup must fail with a message naming the missing variable rather than booting into a broken state. Write a `.env.example` documenting every variable with placeholder values only, and tests covering both a valid configuration and a missing-secret failure.

## 22. Add the database layer and first migration
Goal: Create the task table with SQLAlchemy models and Alembic migrations.
Description: Add SQLAlchemy and Alembic to `apps/api`, configure a session factory reading its URL from configuration, and define the task model matching the field list in the specification's §5 — including `position` for manual ordering and the `completed_at` and `archived_at` nullable timestamps. All timestamps are stored in UTC. Generate the initial migration and add an integration test that applies it to a temporary SQLite database and round-trips one row.

## 23. Implement the deadline and archive-policy domain logic
Goal: Put the specification's derived rules in pure, directly testable functions.
Description: Create `domain/deadline.py` deriving the five deadline states from a deadline, a status and a reference time, and `domain/archive_policy.py` deciding whether a Done task has passed its seven-day window since completion. Neither module may import anything that performs I/O, which is what makes them testable without fixtures. Cover the boundaries the specification pins down exactly: precisely 24 hours remaining, precisely seven days elapsed, and a Done task whose deadline is in the past.

## 24. Implement task ordering domain logic
Goal: Define manual ordering and cross-column moves as pure functions.
Description: Create `domain/ordering.py` with functions computing new position values for reordering within a column and for moving a task to a given index in another column, each returning the complete set of positions that changed so the caller can persist them in one transaction. Keep the module free of database access. Cover moving to the first slot, the last slot, and into an empty column.

## 25. Implement authentication
Goal: Let the single user log in, log out, and read their session.
Description: Add password hashing, session cookie issuing and verification, and login rate limiting, then expose the `/api/v1/auth` endpoints for login, logout and session read. The session cookie must be HTTP-only, Secure and SameSite, and no endpoint may ever return the password hash or echo a plaintext password into logs. Include integration tests for a successful login, a wrong password, and a rate-limited rejection.

## 26. Add the CSRF origin check
Goal: Reject state-changing requests that come from a foreign origin.
Description: Because the reverse proxy serves both tiers from one hostname, CSRF protection reduces to verifying the `Origin` header against the configured application origin on every non-idempotent request. Add middleware that does so and returns a clear error in the standard envelope on mismatch, letting safe methods through unchecked. Test an allowed origin, a foreign origin, and a request carrying no `Origin` header at all.

## 27. Implement the error envelope and structured logging
Goal: Return one consistent error shape and log with secrets redacted.
Description: Add an exception handler rendering every error as a stable machine-readable `code`, a user-safe `message` and optional field-level detail, and make request-validation failures map onto that same envelope rather than FastAPI's default shape. Add a structured logger that redacts passwords, session tokens, API keys and chat prompts by default. Include a test asserting that a redacted value never reaches log output.

## 28. Implement task CRUD endpoints
Goal: Expose list, read, create and update for tasks.
Description: Add `/api/v1/tasks` and `/api/v1/tasks/{id}` backed by a repository over the SQLAlchemy task model, with pydantic schemas using the `snake_case` field names from the specification's §5. Title and content are required, a deadline may be absent, and new tasks default to `todo` status and `medium` priority. Cover the creation defaults, rejection of a missing title or content, and rejection of invalid category, priority and status values.

## 29. Implement task move and reorder endpoints
Goal: Persist board moves and manual ordering.
Description: Add the move and reorder endpoints on top of the pure ordering logic, setting `completed_at` when a task enters Done and clearing it when the task leaves Done. Mutations must run in a single transaction so a partially applied reorder is impossible. Test that manual order survives a round-trip, that moving into Done stamps the completion time, and that moving back out clears it.

## 30. Implement archive endpoints
Goal: List, search, restore and permanently delete archived tasks.
Description: Add `/api/v1/archive` with pagination ordered by newest completion first, plus case-insensitive substring search on title only, and the restore and permanent-delete endpoints. Restore must return the task to Todo, clear both `completed_at` and `archived_at`, and place it at the end of the Todo column. Test that search does not match content, notes or URLs, and that a restored task lands last in Todo.

## 31. Implement the settings endpoints
Goal: Read and update timezone and non-secret LLM settings, and change the password.
Description: Add `/api/v1/settings` and `/api/v1/settings/password`. The settings response must never include the LLM API key, the database URL or any other secret, and a password change must require the correct current password. Test that a settings read contains no secret values, and that a wrong current password is rejected without changing the stored hash.

## 32. Add the scheduled archive job
Goal: Archive Done tasks once their seven-day window has passed.
Description: Add a job that applies the archive policy and stamps `archived_at`, plus an entrypoint that runs it hourly as its own process rather than inside an API worker — in-process scheduling double-fires when more than one worker runs. Include a command to run the job once on demand for testing. Cover both that an eligible task is archived and that a task moved out of Done before the window elapsed is not.

## 33. Add the administrative password reset command
Goal: Let the owner reset a forgotten password from the VPS.
Description: Add a command runnable inside the API container that sets a new password hash for the single user, prompting for the password interactively rather than taking it as an argument that would land in shell history. Document the exact invocation in `docs/ops/`. The specification's first acceptance criterion depends on this command existing and being documented, so neither half is optional.

---

# Phase 5 — Connecting the tiers

## 34. Generate TypeScript types from the OpenAPI schema
Goal: Derive the web tier's wire types from the API's own schema.
Description: Add `openapi-typescript` to the web tier along with a script writing generated types into `src/shared/api/schema.gen.ts` from the API's `openapi.json`. Commit the generated output and add a CI step that regenerates it and fails when the result differs, so contract drift becomes a build failure instead of a runtime surprise. Generate types only — a generated client would create a second API surface that components could call directly, dissolving the adapter boundary.

## 35. Implement the HTTP API client
Goal: Implement the existing ApiClient interface against the live API.
Description: Add `services/api/http/` containing a fetch wrapper that sends credentials and maps error responses onto the shared error type, a mapper module converting `snake_case` wire fields to the `camelCase` domain model, and endpoint functions implementing every method of the `ApiClient` interface in `src/services/api/ApiClient.ts`. Select between the mock and HTTP implementations by environment variable in `services/api/index.ts`. No page component may change — that property is the specification's sixteenth acceptance criterion.

## 36. Unit-test the field mapper
Goal: Cover the single point of failure for wire-to-client naming.
Description: The mapper is the only place field names convert between the two tiers, so an error there is invisible everywhere else in the codebase. Add direct unit tests round-tripping every task, chat, settings and session field, including a null deadline, an empty URL list and an empty Markdown note. Assert that an unrecognized wire field does not silently pass through unmapped.

---

# Phase 6 — AI functions

## 37. Add the LLM client and prompt redaction
Goal: Talk to the configured OpenAI-compatible endpoint without leaking prompts into logs.
Description: Add an LLM client reading its base URL, API key and model name from configuration, with a request timeout, a cancellation path and a mock implementation for deterministic tests. Add the redaction helper that strips prompts and task content from log output. This task ships no product feature — it is the shared foundation for both parsing and chat, and keeping it separate means the two features that follow do not each re-solve it.

## 38. Implement natural-language task parsing
Goal: Turn free text into a validated task draft proposal.
Description: Add `/api/v1/ai/parse-task`, which sends the user's text to the LLM requesting schema-constrained output and validates the result against server-side schemas before returning it. The endpoint must never create a task — it returns a draft the user will review and confirm — and invalid or partial model output must produce a recoverable error rather than a malformed draft. Test with fixture responses covering a clean parse, an invalid category value, and a malformed date.

## 39. Implement chat conversation storage
Goal: Persist the single current conversation and allow replacing it.
Description: Add the conversation and message models with a migration, plus `/api/v1/chat/conversation` for reading and resetting. Exactly one conversation exists at a time, and starting a new one permanently replaces the previous conversation and all its messages. Test that a reset removes prior messages, and that task changes confirmed during the old conversation remain intact afterwards — chat history is not an audit log.

## 40. Implement chat read tools
Goal: Let the assistant answer questions about tasks without writing anything.
Description: Add the read-side tool implementations the assistant may call — search active tasks, search the archive by title, and query for overdue, due-soon, high-priority or per-category tasks — and wire them into `/api/v1/chat/messages`. Each tool must return only the minimum task data needed to answer the request. Read-only exchanges require no confirmation, so this task delivers a working question-and-answer assistant on its own.

## 41. Implement proposed write actions with confirmation
Goal: Let the assistant propose changes that apply only after the user confirms.
Description: Add proposed-action persistence plus the confirm and reject endpoints, so a chat message can return a structured preview showing old and new values while writing nothing. Confirmation must be idempotent — a repeated confirm must not duplicate a task or apply an edit twice — and the API, not the model, validates task existence, field values and legal state transitions. Test a confirm, a reject, and a duplicate confirm of the same action.

---

# Phase 7 — Deployment

## 42. Containerize both applications
Goal: Produce production images for the web and API tiers.
Description: Add a multi-stage Dockerfile for each application: the web tier building the Nitro node-server output and serving it with Node, the API tier installing dependencies and running uvicorn as a non-root user. Both must build from a clean checkout with no reliance on local state. Verify that each container starts and serves its health path.

## 43. Add the Compose stack and reverse proxy
Goal: Run the full six-service stack locally with single-origin routing.
Description: Add `deploy/compose.yml` defining caddy, web, api, scheduler, db and backup, where only caddy publishes ports and the proxy routes `/api/v1/*` to the API and every other path to the web tier. All other services stay on the private network. Confirm the application is reachable through the proxy and that the API and database are not reachable directly from the host.

## 44. Switch production to PostgreSQL and verify migrations
Goal: Run the same migration history against Postgres.
Description: Point the production configuration at the Compose Postgres service and confirm the Alembic history applies cleanly from an empty database, with no application-level model forks between SQLite and Postgres. Add a CI job running the integration suite against Postgres in addition to SQLite. The specification's seventeenth acceptance criterion requires both to pass.

## 45. Add database backup and restore
Goal: Keep seven daily backups and prove a restore works.
Description: Add the daily 03:00 backup job in the configured application timezone, retaining the latest seven successful runs on a persistent volume, and confirm the dumps contain no plaintext application or LLM credentials. Write the restore command and document both in `docs/ops/backup-restore.md`. Execute the restore successfully at least once — the specification requires a tested restore, not merely a documented one.

## 46. Configure HTTPS and the production domain
Goal: Serve the application over HTTPS with HTTP redirected.
Description: Configure the reverse proxy for the production domain with automatic certificates, redirecting HTTP to HTTPS once the domain resolves. Record in `docs/ops/deploy.md` that plain-HTTP access by IP is for initial setup only and is not approved for normal use, because it exposes login credentials in transit. Confirm both the redirect and a valid certificate from outside the host.

## 47. Verify the performance targets against a full-size dataset
Goal: Confirm the specification's §15.2 latency targets hold at 10,000 tasks.
Description: Seed a database with 10,000 tasks spread across the three statuses and a realistic mix of deadlines, then measure the four targets the specification sets: initial authenticated board load under two seconds, non-AI mutations under 500 ms of server response time, archive title search under 500 ms, and an immediate progress state with a working cancel on AI requests. Add whatever indexes the measurements show are needed — archive title search and per-status ordered reads are the likely candidates. Record the measured figures in `docs/ops/` so a later regression has a baseline to fail against.

## 48. Collapse the git history and publish
Goal: Replace the published history with a single clean root commit.
Description: Squash the repository to one root commit containing the finished tree and force-push over `origin/main`. This is necessary because the existing published history contains a commit message naming the frontend-generation vendor and a tracked document specific to it, neither of which a working-tree deletion removes. Afterwards, confirm that a fresh clone contains no vendor reference in any file or commit message. The step is irreversible, so run it only once the tree is otherwise final.

## 49. Run the release acceptance pass
Goal: Verify all twenty-five acceptance criteria before declaring v1 complete.
Description: Work through the specification's §17 list against the deployed stack and record the outcome of each criterion. Pay particular attention to the ones automated tests do not reach: representative mobile browser widths, the documented password reset executed on the VPS, the restore procedure, and confirmation that no frontend bundle or API response contains the LLM API key, database credentials or password hashes. Record the results in `docs/ops/`.
