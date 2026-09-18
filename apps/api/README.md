# Planora API

Requires Python 3.12 or newer and `uv`. Run these commands from `apps/api`:

```sh
uv sync --locked
uv run pytest --cov --cov-fail-under=80
uv run ruff check .
uv run uvicorn planora_api.main:create_app --factory --host 127.0.0.1 --port 8000
```

`GET http://127.0.0.1:8000/api/v1/health` returns `200` with
`{"status":"ok"}`. This baseline requires no database, secrets or external
services. The web application runs independently.
