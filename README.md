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

To check the web tier against a real API, run `bun run e2e:http` from
`apps/web`. It is a five-test HTTP-mode smoke suite: it starts its own
uvicorn API and web dev server on free ports, on a fresh migrated SQLite
database under `.tmp/`, and never reads `apps/api/.env`. It needs `uv sync`
in `apps/api` first, and it runs in CI as the `e2e-http` job.

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
```

Edit `apps/api/.env` and fill in **only `LLM_API_KEY`** — use `LLM_API_KEY=placeholder`
if you don't have a real key yet, which leaves AI parsing and chat
unavailable (see the note below for a real key). Leave `SESSION_SECRET`
and `APP_ORIGIN` blank. The local launcher generates a private random
session secret and uses `http://localhost:5173` automatically.

**One-time account creation**, from the repository root:

```sh
scripts/run-local.sh --setup-account
```

This installs API dependencies and applies migrations to the local database,
then runs the existing interactive account command with the same local defaults.
Follow the prompts to set the single account's username and password. Run this
mode again only when you want to reset the password; normal launch keeps your
account credentials.

**Launch**, from the repository root:

```sh
scripts/run-local.sh
```

This installs dependencies, applies migrations, then starts the API, the
web dev server (in HTTP mode, regardless of `apps/web/.env`) and the
archive scheduler, and prints the URL to open once the API is healthy.
Press `Ctrl-C` to stop all three cleanly.

Optional overrides belong in `apps/api/.env`: set `APP_ORIGIN` to
`http://localhost:<port>` or `http://127.0.0.1:<port>` (port 1–65535) to
choose the exact web address. A busy port fails rather than selecting another.
Set a stable `SESSION_SECRET` (for example, generate one with
`openssl rand -hex 32`) to keep sessions usable across restarts. When it is
blank, each launcher invocation uses a new secret: sign in again after
restarting. Generated secrets are never printed, saved or written to `.env`.

These defaults apply only to `scripts/run-local.sh` and its account setup mode.
Direct API, scheduler and administrative commands, and deployment, still
require explicit nonblank `SESSION_SECRET`, `APP_ORIGIN` and `LLM_API_KEY`.

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
