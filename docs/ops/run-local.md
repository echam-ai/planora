# Run Planora locally (macOS, no Docker)

One launcher starts the real stack — the API, the web app in HTTP mode,
and the hourly archive job — with no Docker.

**Prerequisites:** `uv` and `bun` installed. Docker is not required and is
never used by this path.

**One-time setup**, from the repository root:

```sh
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` and fill in three values. `LLM_API_KEY`: use
`LLM_API_KEY=placeholder` if you don't have a real key yet, which leaves AI
parsing and chat unavailable (see the note below for a real key).
`APP_PASSWORD`: the one shared site password, at least 12 characters. `SESSION_SECRET`:
the secret that signs the access cookie, at least 32 characters, for example the output
of `openssl rand -base64 32`. The launcher refuses to start when either is blank or too
short, and never prints them. Leave `APP_ORIGIN` blank; the launcher uses
`http://localhost:5173` automatically. There are no accounts or usernames.
Open the app, enter `APP_PASSWORD` on the unlock page, then choose
**Hamster Knight** or **Ech Princess**. Profile choice separates saved data and
is not identity protection; the shared password is the only gate. **Lock** in the
account menu signs out of that browser. Changing `APP_PASSWORD` or
`SESSION_SECRET` (and restarting) signs every browser out, which is also how to
revoke a copied cookie.

**Launch**, from the repository root:

```sh
scripts/run-local.sh
```

This installs dependencies, applies migrations, then starts the API, the
web dev server (in HTTP mode, regardless of `apps/web/.env`) and the
archive scheduler, and prints the URL once the web app, API and API proxy
respond successfully. Follow [Stop local Planora](#stop-local-planora) below
to shut down all three services.
If a required port is occupied, launch fails before starting services. Stop
the existing launcher using the shutdown steps below, then retry.

Optional overrides belong in `apps/api/.env`: set `APP_ORIGIN` to
`http://localhost:<port>` or `http://127.0.0.1:<port>` (port 1–65535) to
choose the exact web address. A busy port fails rather than selecting another.
Direct API and scheduler commands and deployment require explicit nonblank
`APP_ORIGIN`, `LLM_API_KEY`, `APP_PASSWORD` (at least 12 characters) and
`SESSION_SECRET` (at least 32); startup fails fast, naming each offender,
when any is missing or too short. Neither profile has its own credentials.

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

## Stop local Planora

For a stack started with `scripts/run-local.sh`, press **Ctrl+C once in the
original launcher terminal**. Wait for `planora: Stopped.` before closing
that terminal. The launcher sends `SIGTERM` to all three service process
groups (API, web dev server and archive scheduler), including their child
processes. It allows a shutdown grace period of up to 10 seconds, then
forcibly stops any groups still running with `SIGKILL`.

**If the original terminal is gone**, open another terminal and find the
launcher:

```sh
pgrep -fl 'run-local[.]sh'
```

Identify the launcher for your Planora checkout in the output. Replace the
example PID `12345` below with that launcher's actual PID, then send it
`SIGTERM` to trigger the same shutdown sequence:

```sh
kill -TERM 12345
```

Allow the grace period to finish, then check the ports as shown below.

**If no launcher remains and port 8000 is still occupied**, inspect its
listener:

```sh
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

Take the listener's PID from the output. Replace the example PID `23456`
in both commands below with that actual PID. First inspect the process:

```sh
ps -p 23456 -o pid,ppid,command
```

Confirm that the command belongs to Planora's API (for example, it includes
`uvicorn planora_api.main:create_app` and your checkout's API environment).
Only after confirming it is Planora, send `SIGTERM` to that specific PID:

```sh
kill -TERM 23456
```

Do not kill every matching process or an unidentified listener. Without the
launcher, stopping the API alone does not stop the web server or scheduler;
identify and confirm any remaining Planora processes before stopping their
specific PIDs.

**Verify the ports are free** before restarting:

```sh
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

No listener output means those ports are free. If you set a custom web port
through `APP_ORIGIN` in `apps/api/.env`, replace `5173` in the second command
with that port; the API still uses `8000`. If a listener remains, inspect and
confirm its owning process before sending any signal.

