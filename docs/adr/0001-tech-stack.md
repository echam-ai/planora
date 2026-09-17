# ADR 0001 — Tech stack: TanStack Start web tier with a Python FastAPI API tier

- **Status:** Accepted
- **Date:** 2026-09-17
- **Supersedes:** the stack assumptions in `ai-task-manager-v1-product-spec.md`

## Context

Planora is a private, single-user task manager: a three-column Kanban board, a
searchable archive, one chat conversation with an AI assistant that proposes
changes for confirmation, and an hourly job that archives completed tasks. It
targets a personal dataset of up to 10,000 tasks on a single VPS behind Docker
Compose.

The original specification committed to a Python FastAPI backend and described
the frontend as a generated responsive web UI with a mock backend — implicitly a
single-page application that would call FastAPI over HTTP.

That premise turned out to be wrong. The generated frontend is a **TanStack
Start** application: React 19 on Vite, with its own Nitro server, server
functions, and CSRF middleware already configured. The frontend therefore
arrived with a server tier capable of owning the API, which reopened the backend
decision rather than settling it.

Relevant constraints:

- One user. No multi-tenancy, no permissions, no concurrent-editing problem.
- The AI surface is small: one text-parsing call and one tool-calling chat loop.
- All writes are user-confirmed, so the model never needs write access.
- Deployment is a single VPS, not a managed platform.
- A mock `ApiClient` interface already cleanly separates UI from data access.

## Options considered

### Option A — All-TypeScript monolith on TanStack Start

The existing Nitro server becomes the API. Drizzle ORM against PostgreSQL
(SQLite in development), the `openai` SDK against the Kimi-K3 base URL with zod
schemas for structured output, and the archive job in a small scheduler.

One language, one build, one container. zod schemas shared verbatim between
browser and server, so no code generation step and one source of validation
truth. The `ApiClient` interface gets a real implementation with no UI changes.
SSR, session cookies, and CSRF already work.

Against it: it discards the specification's approved backend decision; the
TanStack Start / Vite 8 / beta Nitro combination is bleeding-edge and will churn;
and TypeScript's LLM tooling, while adequate, is thinner than Python's for
prompt iteration and evaluation harnesses.

### Option B — TanStack Start web tier plus a Python FastAPI API tier (chosen)

Two services. FastAPI owns everything behind `/api/v1` — SQLAlchemy models,
Alembic migrations, authentication, the archive job, and LLM integration. The
web tier keeps its mock layer for development and gains an HTTP adapter
generated from the API's OpenAPI schema.

For it: it matches the approved specification, so §13 and §14 need no
reversal. Python has the strongest ecosystem for schema-constrained LLM output
and prompt work. Alembic is a more mature migration story than anything in the
TypeScript ecosystem. The API is testable with `pytest` in complete isolation
from the frontend, and can outlive the current frontend if the UI is ever
replaced.

Against it: two languages, two toolchains, two test suites, two containers, and
two dependency-update streams — for an application with one user. Types are
duplicated and reconciled by code generation, which must be actively kept from
drifting.

### Option C — Hybrid: TypeScript owns data, Python owns AI only

Option A's TypeScript tier owns authentication, tasks, archive, settings, and
the database. A small FastAPI service owns only text parsing and the chat
tool-calling loop, with no database access and no public port.

This puts Python where Python wins without duplicating CRUD types, keeps the
AI-facing contract down to roughly four endpoints, and makes "the backend, not
the model, validates" structurally true because the AI service physically
cannot write. Against it: still two languages and two containers, one extra
network hop per AI call, and two schema dialects mirrored by hand.

### Option D — Static SPA plus FastAPI

Build the frontend to static assets served by the reverse proxy and let FastAPI
do everything, removing Node from production entirely. Simplest production
topology and the most literal reading of the original specification, but it
discards the SSR and server-function infrastructure already built and pushes
TanStack Start into an SPA mode it is not designed for.

## Decision

**Option B.** The web tier is TanStack Start; the API tier is Python FastAPI
under `/api/v1`.

Option A was recommended on cost grounds: for one user, three columns, one chat
thread, and an hourly cron, a dual-stack CRUD layer is more machinery than the
problem needs, and zod plus the `openai` SDK cover the AI surface comfortably.

Option B was chosen deliberately in preference to that recommendation. The
decisive considerations were keeping the approved specification intact, Python's
advantage for the AI work that carries the most iteration risk, and an API tier
that is independently testable and outlives any particular frontend.

Two decisions follow from the choice and are recorded here because they are what
make Option B affordable:

**Single origin.** The reverse proxy serves both tiers from one hostname,
routing `/api/v1/*` to the API and everything else to the web tier. This removes
CORS entirely, makes the session cookie first-party so `SameSite` does its job,
and reduces CSRF protection to an origin check. Two origins would have cost
materially more in both implementation and review.

**Browser-only data access.** The Nitro server renders the application shell and
serves assets; it does not fetch application data. Without this, every
authenticated request would need a second server-side path with session-cookie
forwarding, giving authentication two call sites to secure and test. The cost is
a brief loading state before an unauthenticated visitor is redirected — an
acceptable trade for a private single-user application.

## Consequences

Accepted:

- Two languages and two test suites to maintain and keep current.
- OpenAPI type generation with a CI drift check is now mandatory rather than
  optional; see ADR 0002.
- Field naming differs between wire and client, requiring one mapping layer;
  see ADR 0002.
- One extra container, plus a dedicated scheduler service so the hourly archive
  job cannot double-fire across API workers.

Retained:

- The existing frontend in full, including the `ApiClient` seam that keeps
  acceptance criterion 16 satisfiable.
- The approved specification's API surface and phasing.

Reversible:

- Option C remains reachable from B by moving CRUD into the web tier while
  keeping the AI service, should the dual-stack overhead prove not to earn its
  keep. Nothing in this decision forecloses that.
