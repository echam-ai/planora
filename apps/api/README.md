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
