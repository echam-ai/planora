# Planora operational diagnosis

Snapshot of the production stack at https://planora.ai-tracker.cloud, taken right after the 2026-10-06 deploy with [`scripts/ops-diagnose.sh`](../scripts/ops-diagnose.sh) (`PLANORA_COMPOSE_OVERLAY=behind-proxy`). The raw output follows the summary. Host identifiers are omitted.

## Diagnosis summary

| Area | Observation | Assessment / action |
| --- | --- | --- |
| Services | All 6 running. `api`, `db` and `web` report healthy. `scheduler` and `backup` have no healthcheck by design. | OK |
| Health and TLS | Internal health is `ok`. Public HTTP→HTTPS returns 308, and the public `/api/v1/health` returns 200 in 27 ms. Let's Encrypt certificate valid until 2027-01-04. | OK. The host Caddy renews the certificate automatically. |
| Database | Alembic is at head (`209e984e239b`) on PostgreSQL. | OK |
| Archive job | Ran on start and archived 0 tasks, which is expected on a fresh database. | OK |
| Backups | **No recovery points yet.** The stack was 3 minutes old, and the daily worker hadn't run its first backup. | Action: take a manual backup now (see [`backup-restore.md`](../docs/ops/backup-restore.md)) and re-check after 24 h for one daily point. |
| Errors (24 h) | 0 errors in every service. API: 1 warning, an expected `401` on an unauthenticated `/api/v1/tasks` probe. Caddy: 4 warnings at startup. db: 1 warning on first init. | No action. Re-check the Caddy warnings if they repeat after startup. |
| Resources | Disk 12% used, 6.2 GiB memory available, stack uses about 200 MiB in total. Docker build cache is 7.2 GB (5.2 GB reclaimable). | Optional: `docker builder prune` after deploys. |

- Generated: 2026-10-06T03:04:59Z
- Commit: 01ff4a4
- Compose project: planora
- Domain: planora.ai-tracker.cloud

## Services

```text
SERVICE     STATE     <no value>   STATUS
api         running   healthy      Up 35 seconds (healthy)
backup      running                Up 2 minutes
caddy       running                Up 2 minutes
db          running   healthy      Up 3 minutes (healthy)
scheduler   running                Up 29 seconds
web         running   healthy      Up 2 minutes (healthy)
```

## Health endpoints (from inside the stack)

```text
api  /api/v1/health -> {"status":"ok"}
web  /health        -> {"status":"ok"}
db   pg_isready     -> /var/run/postgresql:5432 - accepting connections
```

## Public endpoint and TLS

```text
http redirect: 308 -> https://planora.ai-tracker.cloud/?check=redirect
{"status":"ok"}  (200, 0.027399s)
issuer=C=US, O=Let's Encrypt, CN=YE2
subject=CN=planora.ai-tracker.cloud
notAfter=Jan  4 02:03:50 2027 GMT
```

## Database migration state

```text
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
209e984e239b (head)
```

## Backups (latest recovery points)

```text
total 0
```

## Scheduler (archive job) — last runs

```text
scheduler-1  | {"timestamp":"2026-10-06T03:04:33.134Z","level":"INFO","logger":"planora_api.jobs.archive_done_tasks","message":"archive_job_completed","now":"2026-10-06T03:04:33.094917+00:00","archived_count":0,"duration_ms":39.766}
```

## Warnings and errors in the last 24h (counts)

```text
caddy      errors=0     warnings=4
api        errors=0     warnings=1
web        errors=0     warnings=0
scheduler  errors=0     warnings=0
db         errors=0     warnings=1
backup     errors=0     warnings=0
```

## Most recent API warnings/errors (redacted by the app)

```text
api-1  | {"timestamp":"2026-10-06T03:04:55.477Z","level":"WARNING","logger":"planora_api.request","message":"Request completed","request_id":"dff379c3-13d5-4542-8bf0-add49ad0d3ec","method":"GET","path":"/api/v1/tasks","status":401,"duration_ms":0.396}
```

## Host resources

```text
 03:05:05 up 4 days, 22:13,  1 user,  load average: 0.17, 0.80, 0.59

Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        96G   11G   85G  12% /
/dev/sda1        96G   11G   85G  12% /

               total        used        free      shared  buff/cache   available
Mem:           7.7Gi       1.5Gi       421Mi        18Mi       6.1Gi       6.2Gi
Swap:             0B          0B          0B

TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          7         6         2.433GB   160.8MB (6%)
Containers      7         7         57.34kB   0B (0%)
Local Volumes   9         9         50.76MB   0B (0%)
Build Cache     105       0         7.208GB   5.202GB
```
```text
NAME                  CPU %     MEM USAGE / LIMIT
planora-scheduler-1   0.00%     57.2MiB / 7.75GiB
planora-api-1         0.23%     64.49MiB / 7.75GiB
planora-backup-1      0.00%     8.07MiB / 7.75GiB
planora-caddy-1       0.00%     10.76MiB / 7.75GiB
planora-web-1         12.36%    30.16MiB / 7.75GiB
planora-db-1          0.00%     29.41MiB / 7.75GiB
```
