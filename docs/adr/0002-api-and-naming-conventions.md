# ADR 0002 — API contract, schema sharing, and naming conventions

- **Status:** Accepted
- **Date:** 2026-09-17
- **Depends on:** ADR 0001

## Context

ADR 0001 put a Python API tier behind a TypeScript web tier. That creates three
problems a single-language stack would not have had:

1. **Two idiomatic naming conventions.** Python and the existing specification
   use `snake_case` (`deadline_at`); the existing TypeScript domain model uses
   `camelCase` (`deadlineAt`). Both are correct in their own language.
2. **Two type systems describing one contract.** Pydantic models and TypeScript
   types must agree, and nothing enforces that automatically.
3. **Two places validation could live.** Without a rule, business rules get
   half-implemented on each side and disagree at the edges.

The current code already shows the third problem in miniature: validation
schemas are declared inline inside the task form and the login route, so there
is no single definition of what a valid task is even within the frontend.

## Decision

### Wire format is snake_case; TypeScript stays camelCase

The API speaks `snake_case`, matching both Python convention and the field names
already specified in the product specification's data model. The TypeScript
domain model stays `camelCase`, matching both JavaScript convention and the
existing frontend code.

Conversion happens in exactly one module — the mapping layer inside the web
tier's HTTP adapter (`services/api/http/mappers.ts`). No other file on either
side converts field names.

The alternative — forcing one convention across both tiers — was rejected
because it makes one side permanently unidiomatic, and because either direction
would have required rewriting code that is already correct. A single mapping
module is a smaller, more reviewable surface than pervasive foreign-looking
field names.

### OpenAPI generates types, not a client

FastAPI's generated `openapi.json` is the single source of truth for the wire
contract. `openapi-typescript` generates **types only** into the web tier. A
hand-written adapter implements the existing `ApiClient` interface against those
types.

Generated clients were rejected. They produce a second API surface that
components would be tempted to call directly, which would dissolve the
`ApiClient` seam that acceptance criterion 16 depends on. Generated types plus a
hand-written adapter keep the seam intact while still making contract changes a
compile error.

CI regenerates the types against the live schema and fails the build if the
result differs from the committed output. Contract drift becomes a build failure
rather than a runtime surprise. This is acceptance criterion 21.

### The API tier is the only authority

Business rules — field validity, state transitions, ordering, archive
eligibility, and authorization — are implemented in the API tier and nowhere
else.

The web tier's zod schemas exist for immediate user feedback and nothing more.
They may be more permissive than the API but must never be more restrictive, or
the UI will reject input the API would have accepted. The API re-validates every
request regardless of what the client checked.

This rule is what makes the specification's confirmation model sound: the
assistant proposes, and the API — not the model, and not the browser — decides
whether a proposal is legal.

### Shared domain schemas replace inline ones

The web tier's validation schemas move out of components into
`shared/domain/`, with TypeScript types inferred from the schemas rather than
declared separately. A task is defined once per tier: once in
`shared/domain/task.ts` and once in the API's pydantic schemas, with the OpenAPI
drift check keeping them honest.

### Errors use one envelope

Every API error returns a stable machine-readable `code`, a user-safe `message`,
and optional field-level detail. The web tier maps `code` to user-facing copy;
it never parses `message` to decide behavior. Structured logging on the API side
carries the diagnostic detail that the response deliberately omits.

## Consequences

- Adding a field touches three places by design: the pydantic schema, the
  regenerated types, and the mapper. The drift check ensures a forgotten step
  fails the build rather than shipping.
- The mapping module is a genuine single point of failure for field naming.
  It warrants direct unit tests, not just incidental coverage through
  integration tests.
- Client-side validation is intentionally allowed to lag the API's. Any rule
  that must not be bypassed belongs on the API, and no reviewer should accept a
  client-only business rule.
- Because the API owns all rules, its pure-logic modules carry the specification's
  most acceptance-tested behavior. That is why the module structure isolates
  them in an I/O-free `domain/` package.
