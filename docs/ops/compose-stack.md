# Six-service setup and verification

This stack runs Caddy, the #42 web/API images, the existing hourly scheduler,
PostgreSQL 17, and a real daily backup worker. Run commands from the repository
root. Plain HTTP is for loopback/setup checks only; regular public access needs
#46's domain/HTTPS configuration. Caddy alone publishes a port. API, web, and
workers have no host port bindings, and PostgreSQL uses an internal data network.
The proxy bridge allows the API to contact its configured LLM endpoint.

## Configuration

Copy `deploy/.env.example` to a private environment file and fill every empty
value. Keep secrets out of git and do not print expanded Compose configuration.
`APP_ORIGIN` must exactly match the browser URL, including scheme and port.
`DATABASE_URL` uses `postgresql+psycopg://USER:PASSWORD@db:5432/DATABASE`, with
the same database credentials as `POSTGRES_*`; URL-encode its password component.
The API and scheduler share that exact URL. Choose an unused `PROXY_SUBNET` and
set `CADDY_IP` to one address inside it; Caddy is assigned that address and
uvicorn trusts only that specific peer for forwarded headers.
Set `PROXY_DYNAMIC_RANGE` to a pool inside that subnet excluding `CADDY_IP`, so
another container cannot consume Caddy's address before the proxy starts.

Caddy preserves `Origin` and the API path prefix, replaces incoming forwarded
client-IP/protocol/host values with its own peer observations, and removes
`Forwarded`/`X-Real-IP`. Do not place another proxy ahead of this configuration
without reviewing the trust chain. See the [Caddy reverse proxy
documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
and [uvicorn proxy settings](https://www.uvicorn.org/settings/).

For disposable verification, create `.tmp/compose43.env` with these fake values
(change port/subnet if they conflict with another project):

```dotenv
CADDY_BIND_ADDRESS=127.0.0.1
CADDY_HTTP_PORT=18080
APP_ORIGIN=http://127.0.0.1:18080
PROXY_SUBNET=172.30.43.0/24
PROXY_DYNAMIC_RANGE=172.30.43.128/25
CADDY_IP=172.30.43.2
IMAGE_TAG=issue-43-smoke
POSTGRES_DB=planora_smoke
POSTGRES_USER=planora_smoke
POSTGRES_PASSWORD=disposable43password
DATABASE_URL=postgresql+psycopg://planora_smoke:disposable43password@db:5432/planora_smoke
SESSION_SECRET=disposable43sessionsecret
LLM_API_KEY=disposable43key
LLM_BASE_URL=https://api.moonshot.ai/v1
LLM_MODEL=kimi-k3
DEFAULT_TIMEZONE=Asia/Singapore
```

## Initialize and start

Use a unique project name for each verification. The commands below use
`planora43-smoke`; never run its destructive cleanup against an existing project.
Builds use application directory contexts and committed lockfiles. Initialize
the existing migration history before starting the scheduler. Account setup
uses the existing interactive administrative command, including hidden password
prompts; no password is passed on the command line.

The migration environment handles three known historical PostgreSQL duplicate
Enum/check declarations while retaining their explicit canonical checks and
leaving shared revision files unchanged. SQLite migration behavior is unchanged.
URL-encoded database passwords are escaped only for Alembic's configuration
parser. Comprehensive backend compatibility remains #44.

```sh
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml config --quiet
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml config --services
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml build
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml up -d --wait db
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml run --rm --no-deps api alembic upgrade head
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml run --rm --no-deps api python -m planora_api.admin.reset_password
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml up -d
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml ps
rtk curl --fail --retry 15 --retry-all-errors --retry-delay 1 http://127.0.0.1:18080/health
rtk curl --fail --retry 15 --retry-all-errors --retry-delay 1 http://127.0.0.1:18080/api/v1/health
rtk curl --fail --retry 15 --retry-all-errors --retry-delay 1 http://127.0.0.1:18080/login
```

Both health requests return `{"status":"ok"}`. The login page and its assets
come from web. An unknown `/api/v1/*` route must return the API error JSON rather
than an HTML page. Login and a non-AI task write use one browser origin and its
first-party session cookie. Unsafe requests without `Origin`, or with a foreign
one, must return `403 CSRF_ORIGIN_MISMATCH`.

The committed Compose browser checks connect to the existing stack; they launch
no development server and alter no schema. Install frozen web dependencies in
the fresh checkout first, then run from `apps/web` with the disposable account
created above. Use the exclusive shared host suite lock and do not overlap this
run with image builds or other suites:

```sh
rtk bun install --frozen-lockfile
(
  rtk flock --exclusive 9 || exit 1
  rtk pgrep -fa '[p]laywright|[v]itest|[p]ytest'
  suite_process_status=$?
  [ "$suite_process_status" -eq 1 ] || exit 1
  PLANORA_E2E_COMPOSE_ORIGIN=http://127.0.0.1:18080 \
  PLANORA_E2E_COMPOSE_USERNAME=smoke43 \
  PLANORA_E2E_COMPOSE_PASSWORD='ComposeSmoke43!Account' \
  rtk bun run e2e:compose
) 9>/home/hamster/code/planora/.tmp/host-suites.lock
```

Use those credentials only for the newly created disposable smoke project.

Inspect port bindings with `docker inspect` for every project container: only
Caddy may have nonempty bindings. On a quiet host with no unrelated service
occupying those ports, direct loopback connections to 8000/5432 must fail.
Inspect the API command to verify `--forwarded-allow-ips` is exactly `CADDY_IP`.
For spoofing checks, send forged `X-Forwarded-For` through Caddy and directly
from an untrusted proxy-network container to API; login-failure rows must record
the actual peer, never the forged address. Keep two disposable client containers
running on the proxy network to obtain distinct source IPs, drive five failed
logins from one and one from the other, and verify only the first is blocked.

## Persistence and workers

The named `postgres-data` volume survives this non-destructive stop/recreate:

```sh
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml down
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml up -d
```

Log in again if needed and read the task created before recreation. API and
scheduler use the same database and migrations; no parallel production schema
exists. #44 adds comprehensive PostgreSQL/SQLite parity and PostgreSQL CI.

Scheduler runs `python -m planora_api.jobs.scheduler`, immediately then every
3600 seconds. It has no inherited API health probe. Against disposable data,
seed one Done task completed more than seven days ago and one completed less
than seven days ago, restart scheduler, and verify only the older task gets
`archived_at`. Its structured log reports `archive_job_completed`; `stop`
interrupts its idle wait without waiting an hour.

Backup schedules `pg_dump` at 03:00 in `DEFAULT_TIMEZONE`, calculating the next
local-calendar occurrence rather than adding a fixed 24-hour delay across DST.
SIGTERM interrupts its schedule wait. A failed dump is logged without database
credentials; partial output is removed and only a successful nonempty dump is
published atomically. The worker runs as the image's `postgres` user. The
one-shot invocation performs the exact same operation into the persistent
`backups` volume:

```sh
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml run --rm --no-deps backup --once
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml exec -T backup sh -c 'for dump in /backups/*.dump; do test -s "$dump" && pg_restore --list "$dump"; done'
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml logs scheduler backup
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml stop scheduler backup
```

`pg_restore --list` must show the application tables, and both workers must
stop cleanly. Unit checks in `tests/unit/test_deployment_backup.py` cover 03:00,
DST, successful publication, and partial/empty failures without waiting overnight.
The worker retains the latest seven successful dumps, ordered by UTC completion
identity after durable publication. See [backup and restore](backup-restore.md)
for exact explicit-target restore commands, decoded credential-content audit,
and the executed disposable PostgreSQL recovery smoke.

## Cleanup disposable verification only

```sh
rtk docker compose --env-file .tmp/compose43.env -p planora43-smoke -f deploy/compose.yml down --volumes --remove-orphans
```

This deletes only that project's disposable database and backup volumes. Normal
stop/recreate must omit `--volumes`. Keep private runtime configuration outside
git and remove only the smoke files/containers you created.
