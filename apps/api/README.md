# Planora API

Requires Python 3.12 or newer and `uv`. Copy `.env.example` to `.env` and
fill in the three required values with no default — `SESSION_SECRET`,
`LLM_API_KEY` and `APP_ORIGIN` — plus any other values you want to change,
before starting uvicorn. Startup fails fast, naming the missing variable, if
a required value is left blank. Run these commands from `apps/api`:

```sh
cp .env.example .env   # then edit .env with real values
uv sync --locked
uv run pytest --cov --cov-fail-under=80
uv run ruff check .
uv run alembic upgrade head   # creates/updates the database at DATABASE_URL
uv run uvicorn planora_api.main:create_app --factory --host 127.0.0.1 --port 8000
```

`GET http://127.0.0.1:8000/api/v1/health` returns `200` with
`{"status":"ok"}` once configuration is valid. The web application runs
independently.

### `APP_ORIGIN`

Set this to exactly the origin your browser shows in its address bar —
scheme, host and port, no path. Every state-changing request (any method
except `GET`, `HEAD` and `OPTIONS`) is rejected with `403
CSRF_ORIGIN_MISMATCH` unless its `Origin` header matches this value (see
`security/csrf.py`). In local development that's the web dev server's
printed Local URL, normally `http://localhost:5173`; in production it's the public
`https://` origin the browser actually loads, e.g.
`https://planora.example`. `localhost` and `127.0.0.1` are different
origins to a browser, so pick the one you actually type into the address
bar — the other one will be rejected.

## OpenAPI contract

`apps/api/openapi.json` is the committed, single source of truth for the
API contract (spec §13.2). Regenerate it after any route or schema change:

```sh
uv run python -m planora_api.openapi
```

This needs no running server, no database connection and no real secrets —
it builds the app from fixed placeholder configuration
(`planora_api/openapi.py`), so it works even with `SESSION_SECRET`,
`LLM_API_KEY` and `APP_ORIGIN` unset. The output is deterministic (fixed
indent, sorted keys, a trailing newline), so re-running it with no contract
change produces no diff. `uv run pytest` includes a test comparing the
committed file to a fresh export, so a stale `openapi.json` fails locally
before CI does; CI (`.github/workflows/ci.yml`) re-exports and runs `git
diff --exit-code -- openapi.json` as an independent check.

After any API contract change, the order is: export here, then regenerate
the web tier's `schema.gen.ts` (`bun run gen:api-types` from `apps/web`),
then commit both files together.

## Database

SQLAlchemy models live in `src/planora_api/db/`; Alembic migrations live in
`alembic/versions/`. Both the session factory (`db/session.py`) and
`alembic/env.py` read the database URL from `Settings.database_url`
(`planora_api/config.py`) — never from `alembic.ini` or `DATABASE_URL` read
directly. Model changes always need a new migration:

```sh
uv run alembic revision --autogenerate -m "describe the change"
# review and correct the generated revision (it is a candidate, not final)
uv run alembic upgrade head
```

## Background jobs

Two standalone commands under `src/planora_api/jobs/` — never imported by
`planora_api.main` or anything under `planora_api/api/`, and never run
inside an API worker process (in-process scheduling would double-fire the
archive job the moment more than one worker runs). Both call the domain
and data layers directly, never the HTTP API, so they need no `Origin`
header past #26's CSRF check. Standard library only (`argparse`, `signal`,
`time`) — no scheduler dependency (`apscheduler`, `celery`, `schedule`,
cron) is added.

Both need the **same environment as the `api` service** — `load_settings()`
requires `SESSION_SECRET`, `LLM_API_KEY` and `APP_ORIGIN` even though
neither job uses them — and a database that already has migrations applied
(`uv run alembic upgrade head`; neither job runs it itself). Neither
publishes a port or exposes an HTTP health endpoint.

### Archive Done tasks once

```sh
uv run python -m planora_api.jobs.archive_done_tasks
```

Archives every Done task whose seven-day window (spec §9.1) has elapsed,
then exits. For manual runs and cron-less testing.

| Exit code | Meaning |
| --- | --- |
| `0` | Success, including when zero tasks were eligible. |
| `1` | The run itself failed (e.g. migrations were never applied). Logged as `archive_job_failed`; never a traceback with task content or a secret. |
| `2` | Invalid configuration (the missing/invalid variable is printed to stderr) or an unrecognized argument. |

### Run the archive job hourly

```sh
uv run python -m planora_api.jobs.scheduler
```

Runs the same job immediately, then again at most 3600 seconds after the
previous run *started* — never skipped, never overlapping within this
process. A failing run is logged (`archive_job_failed`) and the loop
continues on schedule. `SIGTERM`/`SIGINT` stop the loop promptly (well
within `docker stop`'s default 10-second grace) and exit `0`; invalid
configuration exits `2`, the same convention as the run-once command.

This is what #43's Compose `scheduler` service runs from the API image —
Compose wiring itself belongs to that issue, not this one.

## Administrative commands

`src/planora_api/admin/` holds commands run directly on the host, never
through the HTTP API or imported by `planora_api.main`/`api/` — the same
isolation rule as `jobs/` above.

### Reset the password (or create the account on first run)

```sh
uv run python -m planora_api.admin.reset_password
```

See **[`docs/ops/password-reset.md`](../../docs/ops/password-reset.md)**
for the full walkthrough: the production invocation, why `-T` must not be
passed, what a reset does (every session signed out, every login lockout
cleared, all in one transaction), and the exit codes.
