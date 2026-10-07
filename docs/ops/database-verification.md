# SQLite and PostgreSQL verification

Production uses `deploy/compose.yml`: API and scheduler share the explicitly
configured `postgresql+psycopg://...@db:5432/...` URL. Run migrations in the
API service environment, as described in
[the Compose runbook](compose-stack.md). Development still defaults to
`sqlite:///./planora.db`; no application model/repository or revision graph is
swapped between environments. PostgreSQL 17 is used by production Compose, the
test-only Compose file, and the new `API integration (PostgreSQL 17)` CI job.

## Safe shared test selection

From `apps/api`, `--db-backend=sqlite` (the default) uses a new SQLite file under
the checkout's `.tmp/` for every database-backed test. Selecting PostgreSQL
requires the separate `PLANORA_TEST_POSTGRES_URL`; the harness never derives
this target from an application's `DATABASE_URL`. The URL must use psycopg, a
local host (`127.0.0.1`, `localhost`, `::1`, or the local container service names
`db`/`postgres`), a database name starting with `planora_test`, and no query
parameters. Driver query options can override the URL's connection target, so
all are rejected before any connection. Explicit ports and percent-encoded
credentials remain supported. Only after validating the base URL does the
harness append its own schema search-path option.

Each test creates a uniquely named `planora_test_<uuid>` schema, restricts its
connection search path to that schema, migrates via Alembic, and drops only that
schema afterward. Independent app, administrative, and repository connections
use the same selected URL. PostgreSQL tests therefore never silently fall back
to a SQLite file or the public schema. The test user needs permission to create
schemas only in the disposable database. Tests that intentionally need an empty
unmigrated target use the same selected fixture. Configuration-only and fake
local-launcher cases continue to exercise their documented development defaults.

The shared integration corpus includes profile context, tasks and reorder,
archive/search/restore, settings, chat/action persistence, rollback, UTC
timestamps, uniqueness, and the one-conversation-per-profile model's intentional lack
of foreign keys. No PostgreSQL-only core skips are introduced. Both selectors
collect the same cases; the initial #44 state collects integration cases.
No real LLM endpoint is called by these tests.

## Reproduce both complete integration runs

First, from the repository root, start an isolated test-only database:

```sh
rtk docker compose -p planora44-tests -f deploy/compose.test-postgres.yml config --quiet
rtk docker compose -p planora44-tests -f deploy/compose.test-postgres.yml up -d --wait
```

This separate file publishes only a loopback test port, 15444, and stores its
disposable data in tmpfs. It is not a production Compose override. To avoid a
port collision, set `PLANORA_TEST_POSTGRES_PORT` and adjust the URL below.
It uses explicit fake test-only credentials. Never use this user/database for
production. From `apps/api`, install frozen dependencies and run the suites
sequentially under the shared host lock:

```sh
rtk uv sync --frozen
rtk flock --shared "$PLANORA_SUITE_LOCK" \
  rtk uv run pytest tests/integration --db-backend=sqlite
rtk env PLANORA_TEST_POSTGRES_URL=postgresql+psycopg://planora_test:disposable-test-only@127.0.0.1:15444/planora_test44 \
  rtk flock --shared "$PLANORA_SUITE_LOCK" \
  rtk uv run pytest tests/integration --db-backend=postgresql
```

The pytest header identifies the selected backend. The shared
`test_fixture_uses_selected_backend` also inspects the live connection dialect
and PostgreSQL schema, proving that selection reaches the database. Compare
collected IDs with `--collect-only -q` using the same commands/configuration;
both must collect the same collected cases and complete without unexpected skips.
The original SQLite full coverage/lint/OpenAPI CI gate remains independent.

## Empty and seeded migration verification

The shared migration spec uses the selected engine on both runs:

```sh
# From apps/api; add the same explicit PostgreSQL test URL for the PG run.
rtk flock --shared "$PLANORA_SUITE_LOCK" \
  rtk uv run pytest tests/integration/test_database_parity.py tests/integration/test_migration.py tests/integration/test_profile_migration.py --db-backend=sqlite
rtk env PLANORA_TEST_POSTGRES_URL=postgresql+psycopg://planora_test:disposable-test-only@127.0.0.1:15444/planora_test44 \
  rtk flock --shared "$PLANORA_SUITE_LOCK" \
  rtk uv run pytest tests/integration/test_database_parity.py tests/integration/test_migration.py tests/integration/test_profile_migration.py --db-backend=postgresql
```

It applies the same committed history to empty databases, inspects tables and
checks/uniqueness, reruns upgrade safely, and verifies the recorded head is
`209e984e239b`. The seeded regression starts at supported settings revision
`0cf85705ba3d`, inserts representative account, settings, and task rows, then
upgrades to head. It retires legacy credential/session rows and preserves identifiers, timestamps normalized
to UTC, position, JSON URLs, and task content/note. `metadata.create_all` is
not used as a migration substitute. Historical revisions remain unchanged.

For direct CLI reproduction against the new disposable PostgreSQL service,
run from `apps/api` (credentials below are test-only):

```sh
rtk env DATABASE_URL=postgresql+psycopg://planora_test:disposable-test-only@127.0.0.1:15444/planora_test44 \
  LLM_API_KEY=disposable-test-key APP_ORIGIN=https://planora.example \
  APP_PASSWORD=disposable-test-password SESSION_SECRET=disposable-test-session-secret-0123456789 \
  rtk flock --shared "$PLANORA_SUITE_LOCK" rtk uv run alembic upgrade head
rtk env DATABASE_URL=postgresql+psycopg://planora_test:disposable-test-only@127.0.0.1:15444/planora_test44 \
  LLM_API_KEY=disposable-test-key APP_ORIGIN=https://planora.example \
  APP_PASSWORD=disposable-test-password SESSION_SECRET=disposable-test-session-secret-0123456789 \
  rtk flock --shared "$PLANORA_SUITE_LOCK" rtk uv run alembic current
rtk env DATABASE_URL=postgresql+psycopg://planora_test:disposable-test-only@127.0.0.1:15444/planora_test44 \
  LLM_API_KEY=disposable-test-key APP_ORIGIN=https://planora.example \
  APP_PASSWORD=disposable-test-password SESSION_SECRET=disposable-test-session-secret-0123456789 \
  rtk flock --shared "$PLANORA_SUITE_LOCK" rtk uv run alembic upgrade head
```

For SQLite, replace only `DATABASE_URL` with an absolute file URL inside this
checkout's `.tmp/`, e.g. `sqlite:////ABSOLUTE/CHECKOUT/.tmp/direct44.sqlite3`,
and run the same three commands. Create `.tmp` first. Both show the same head;
the second upgrade makes no schema change. Remove only that new scratch file.

## Inspect effective production and development targets

Use a newly named disposable production-format Compose project and private fake
environment file prepared as in the Compose runbook. Build API, start its `db`,
and run this probe in API and scheduler environments from the repository root:

```sh
rtk docker compose --env-file .tmp/compose44.env -p planora44-target -f deploy/compose.yml build api
rtk docker compose --env-file .tmp/compose44.env -p planora44-target -f deploy/compose.yml up -d --wait db
rtk docker compose --env-file .tmp/compose44.env -p planora44-target -f deploy/compose.yml run --rm --no-deps -T api python -c 'from sqlalchemy import text; from planora_api.config import load_settings; from planora_api.db.session import create_engine; e=create_engine(load_settings()); c=e.connect(); assert e.dialect.name=="postgresql" and e.url.host=="db"; print(e.dialect.name, e.url.host, c.execute(text("select current_database()")).scalar_one()); c.close(); e.dispose()'
rtk docker compose --env-file .tmp/compose44.env -p planora44-target -f deploy/compose.yml run --rm --no-deps -T scheduler python -c 'from sqlalchemy import text; from planora_api.config import load_settings; from planora_api.db.session import create_engine; e=create_engine(load_settings()); c=e.connect(); assert e.dialect.name=="postgresql" and e.url.host=="db"; print(e.dialect.name, e.url.host, c.execute(text("select current_database()")).scalar_one()); c.close(); e.dispose()'
```

Both identify PostgreSQL and the same database at host `db`, without printing
credentials. Migrations use `run ... api alembic ...` with that same
environment, which also needs `APP_PASSWORD` and `SESSION_SECRET` (the API and scheduler load the same settings). No account administration is required.
To inspect the SQLite development default from `apps/api`, set only fake required
secrets/origin and print `create_engine(load_settings()).dialect.name`; with
`DATABASE_URL` unset and no local `.env` override it reports `sqlite`.

## Cleanup only newly created verification projects

From the repository root:

```sh
rtk docker compose -p planora44-tests -f deploy/compose.test-postgres.yml down --volumes
rtk docker compose --env-file .tmp/compose44.env -p planora44-target -f deploy/compose.yml down --volumes --remove-orphans
```

The first removes the tmpfs-backed test service; the second deletes only the
newly created target-probe project's disposable PostgreSQL volume. Never run
volume cleanup against an existing production project. Backup/restore and
HTTPS remain #45/#46.
