# Planora

Planora is a private, single-user AI task manager: a three-column Kanban
board, a searchable archive, and one AI chat conversation whose every write
you confirm before it happens.

This is a monorepo: the web tier lives in `apps/web`, the API tier in
`apps/api`. Stack, layout and binding rules are documented once, in
[`AGENTS.md`](AGENTS.md) — this file does not repeat them.

## Web tier

From `apps/web`:

```sh
bun install
bun run dev
```

To exercise a production build locally:

```sh
bun run build
node .output/server/index.mjs
```

Ignore Nitro's own `npx vite preview` hint printed after `bun run build` —
it previews the client build only, not the server entry above.

## API tier

See [`apps/api/README.md`](apps/api/README.md) for setup with `uv`,
environment configuration and running the API.

## Run locally on macOS

One launcher starts the real stack — the API, the web app in HTTP mode,
and the hourly archive job — with no Docker.

**Prerequisites:** `uv` and `bun` installed. Docker is not required and is
never used by this path.

**One-time setup**, from the repository root:

```sh
cp apps/api/.env.example apps/api/.env
openssl rand -hex 32   # paste the output into apps/api/.env as SESSION_SECRET
```

Edit `apps/api/.env` and set `APP_ORIGIN=http://localhost:5173` (the web
dev server's default port). `LLM_API_KEY` ships blank in the template and
startup fails on a blank value, so set it too — `LLM_API_KEY=placeholder`
if you don't have a real key yet, which leaves AI parsing and chat
unavailable (see the note below for a real key). Then apply migrations,
which also creates the local database on first run:

```sh
cd apps/api
uv run alembic upgrade head
```

**One-time account creation**, from `apps/api`:

```sh
uv run python -m planora_api.admin.reset_password
```

Follow the prompts to set the single account's username and password.

**Launch**, from the repository root (the previous step left you in
`apps/api`):

```sh
cd ../..
scripts/run-local.sh
```

This installs dependencies, applies migrations, then starts the API, the
web dev server (in HTTP mode, regardless of `apps/web/.env`) and the
archive scheduler, and prints the URL to open once the API is healthy.
Press `Ctrl-C` to stop all three cleanly.

A placeholder `LLM_API_KEY` (e.g. `LLM_API_KEY=placeholder`) is enough to
start everything — the board, tasks and archive all work — but AI parsing
and chat report unavailable until a real key is configured. To use a real
LLM endpoint, put the key in `LLM_API_KEY`; `LLM_BASE_URL`
(`https://api.moonshot.ai/v1`) and `LLM_MODEL` (`kimi-k3`) are the
defaults and only need changing for a different OpenAI-compatible
endpoint. Settings offers only `LLM_MODEL` as the assistant model unless
`LLM_ALLOWED_MODELS` lists more (comma-separated) that the endpoint also
serves. Restart the launcher after editing `apps/api/.env` — it reads
the file once, at start.

Done tasks are archived only while the launcher is running: once at
start, then again every hour. A task reaches its seven full days either
while the launcher is up (archived within the hour) or is picked up at
the next start.

## Project documents

- [Product spec](docs/specs/planora-v1-product-spec.md)
- [Development process](docs/PROCESS.md)
- [Backlog](docs/tasks.md)
- [Architecture decisions](docs/adr/)
