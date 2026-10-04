# Standalone application images

Run these commands from the repository root with Docker available. Each build
uses its application directory as context; local dependencies, environment
files, databases, and generated output are excluded. The web builder uses the
committed Bun lockfile and always builds `VITE_API_MODE=http`; Node serves Nitro's
`node-server` output. The API builder uses `uv.lock` with Python 3.12 and installs
only production dependencies. Its final image runs the factory with uvicorn as
UID/GID 10001, without uv or dependency installation at startup.

```sh
rtk docker build --no-cache -f apps/web/Dockerfile -t planora-web:issue-42 apps/web
rtk docker build --no-cache -f apps/api/Dockerfile -t planora-api:issue-42 apps/api
```

The internal ports are web 3000 and API 8000, both bound to `0.0.0.0`. These
standalone checks publish loopback ports only. Production networking and proxy
routing belong to #43; these two containers alone do not provide an integrated
deployment.

## Start and check

Use the following disposable configuration. The LLM key is deliberately fake;
neither health endpoint calls an LLM, requires profile selection, or depends on the other
application. SQLite lives in the container's writable `/app/data` directory and
is removed with that container. Health checks do not require schema migration
or profile setup. Use real runtime configuration and migrate the database before
using application features.

```sh
rtk docker run -d --name planora-web-smoke -p 127.0.0.1:13000:3000 planora-web:issue-42
rtk docker run -d --name planora-api-smoke -p 127.0.0.1:18000:8000 \
  -e LLM_API_KEY=disposable-smoke-key \
  -e APP_PASSWORD=disposable-smoke-password \
  -e SESSION_SECRET=disposable-smoke-session-secret-0123456789 \
  -e APP_ORIGIN=http://127.0.0.1:13000 \
  -e DATABASE_URL=sqlite:////app/data/smoke.sqlite3 \
  planora-api:issue-42
rtk curl --fail --retry 15 --retry-all-errors --retry-delay 1 http://127.0.0.1:13000/health
rtk curl --fail --retry 15 --retry-all-errors --retry-delay 1 http://127.0.0.1:18000/api/v1/health
rtk docker exec planora-api-smoke python --version
rtk docker exec planora-api-smoke id
rtk docker inspect --format '{{json .Config.Cmd}} {{json .Config.User}}' planora-api-smoke
```

Both requests must return HTTP 200 and `{"status":"ok"}`; Python must report
3.12 and `id` must report UID 10001. The API image also includes a Docker
health check; the curl commands probe both services. `docker inspect` shows the
factory command and user.

The client adapter is fixed during the web build. To verify runtime environment
cannot change it, run a second web container and inspect its client artifacts
with the same assertions used for the default image:

```sh
rtk docker run -d --name planora-web-runtime-smoke -p 127.0.0.1:13001:3000 \
  -e VITE_API_MODE=mock planora-web:issue-42
rtk curl --fail --retry 15 --retry-all-errors --retry-delay 1 http://127.0.0.1:13001/health
rtk docker exec planora-web-smoke sh -c 'grep -R -q "/api/v1" .output/public/assets && ! grep -R -E -q "planora.mock|seedTasks|createMockApiClient" .output/public/assets'
rtk docker exec planora-web-runtime-smoke sh -c 'grep -R -q "/api/v1" .output/public/assets && ! grep -R -E -q "planora.mock|seedTasks|createMockApiClient" .output/public/assets'
```

## Context and layer inspection

For exclusion verification, create harmless, uniquely named marker files in each
application's `.env` and SQLite paths only when those paths do not already exist.
Also place markers under representative dependency, build-output, and `.tmp`
directories. Rebuild, inspect the final filesystems, and inspect every layer
from `docker image save` for the unique marker contents and paths. Saved images
are verification scratch; stream them through an inspector instead of copying
image tarballs or dependencies into `.tmp`. The API's allowlisted context also
excludes tests and other files not needed in production. Clean up only marker
fixtures created for this check; preserve any existing local data.

## Cleanup

```sh
rtk docker rm -f planora-web-smoke planora-api-smoke planora-web-runtime-smoke
rtk docker image rm planora-web:issue-42 planora-api:issue-42
```

If startup fails, inspect `rtk docker logs <container-name>` before cleanup.
No host database volume or real credential is used by this smoke check.
