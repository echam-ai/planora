# PostgreSQL backup and restore

Run from the repository root. The six-service [Compose stack](compose-stack.md)
uses PostgreSQL 17 and a PostgreSQL 17 `pg_dump`/`pg_restore` backup image. Use
that image's matching tools; no host PostgreSQL installation is needed.
The examples select `planora` and `.tmp/runtime.env` explicitly: substitute your
existing project name and private environment file. Do not print its contents.
No production database is needed for the disposable verification below.

## Schedule, recovery points, and inspection

The backup service runs daily at **03:00 in `DEFAULT_TIMEZONE`**, an IANA timezone
in the deployment environment. It calculates the next local calendar occurrence,
including daylight-saving changes. Changing the API's settings override does not
change the worker's deployment timezone. Restart the worker after changing its
environment. `--once` runs the same operation immediately:

```sh
docker compose --env-file .tmp/runtime.env -p planora -f deploy/compose.yml run --rm --no-deps backup --once
```

Dumps live at `/backups` in the Compose project's persistent `backups` named
volume. Successful files are `planora-YYYYMMDDTHHMMSSffffffZ-UUID.dump`: the UTC
**completion** time, then a unique run identity. Sort filenames lexically to
select the latest successful recovery point. Earlier #43 files with
second-resolution UTC timestamps remain recognized. The UUID breaks same-time
ties; directory iteration order and file modification time do not determine
retention. Manual runs count toward the same seven-success window as daily runs.

The job serializes concurrent runs with a volume lock, writes a mode-0600 custom
PostgreSQL archive to a `.partial` file, fsyncs it, atomically renames it, and
fsyncs the directory before deleting older recovery points. Once seven successful
runs exist, it retains exactly the latest seven. With fewer, it keeps all.
Failed/empty/interrupted dumps never trigger rotation. A hard-kill leftover
`.partial` is incomplete and ignored; `.backup.lock` is coordination, not a dump.
A successful publication followed by a storage error during rotation reports
failure and may temporarily retain extra points; repair storage and retry.
Do not delete any `.dump` to make a failed run look successful.

```sh
docker compose --env-file .tmp/runtime.env -p planora -f deploy/compose.yml exec -T backup sh -c 'find /backups -maxdepth 1 -name "planora-*.dump" -type f | sort'
docker compose --env-file .tmp/runtime.env -p planora -f deploy/compose.yml logs backup
```

Copy one listed full path into `BACKUP` explicitly, then inspect its archive:

```sh
BACKUP=/backups/planora-YYYYMMDDTHHMMSSffffffZ-UUID.dump
docker compose --env-file .tmp/runtime.env -p planora -f deploy/compose.yml exec -T backup pg_restore --list "$BACKUP"
```

Listing establishes the archive's table of contents; an executed restore and
row comparison establish recoverability. Container recreation must preserve
volumes. `up -d --force-recreate db backup` preserves them. Normal stop/recreate
must omit `down --volumes`; that option deletes the recovery points and data.
This is a rolling local backup, not off-site replication.

## Restore into an explicit fresh target

Select a backup from the inventory and a new database name. Names accepted by
the restore wrapper contain letters, digits, underscores and start with a letter
or underscore; connection strings are rejected. The server/user/password come
from the backup service's libpq environment (`PGHOST`, `PGPORT`, `PGUSER`,
`PGPASSWORD`), while `--database` explicitly selects the target. The wrapper
rejects the configured source `PGDATABASE`. Choose a fresh database on this
server; the role must have permission to create it and restore its tables.
For a different recovery server, prepare an isolated Compose project with that
server's libpq configuration and mount/copy the selected dump to its backup
volume, keeping the original dump intact.

```sh
BACKUP=/backups/planora-YYYYMMDDTHHMMSSffffffZ-UUID.dump
RESTORE_DATABASE=planora_recovery_20261002
docker compose --env-file .tmp/runtime.env -p planora -f deploy/compose.yml exec -T db sh -c 'createdb --no-password --username "$POSTGRES_USER" -- "$1"' sh "$RESTORE_DATABASE"
docker compose --env-file .tmp/runtime.env -p planora -f deploy/compose.yml run --rm --no-deps backup --restore "$BACKUP" --database "$RESTORE_DATABASE"
```

The last command executes `pg_restore --no-password --exit-on-error
--single-transaction --no-owner --no-acl --dbname TARGET BACKUP`. There is no
`--clean` or `--create`: existing application tables cause an error and the whole
transaction rolls back. The original source and dumps are read-only during
restore. The new database's objects belong to the restoring role. A missing,
empty, truncated, invalid archive, connection failure, or SQL error returns
nonzero and logs `restore_failed` with an error type; only exit 0 logs
`restore_completed`. After a failed attempt, inspect the exit status, select a
retained successful file, and retry into a fresh target. Never interpret a dump
listing as a successful restore.

Inspect the restored revision, rows, and relationships before switching any
application configuration to the recovered database. The backup represents its
snapshot's migration revision; use the matching application release first.

```sh
docker compose --env-file .tmp/runtime.env -p planora -f deploy/compose.yml exec -T db sh -c 'psql --no-password --username "$POSTGRES_USER" --dbname "$1" --set ON_ERROR_STOP=1' sh "$RESTORE_DATABASE" <<'SQL'
SET TIME ZONE 'UTC';
SELECT version_num FROM alembic_version;
SELECT id, timezone, model_name, updated_at FROM app_settings;
SELECT profile_id, id, status, deadline_at, completed_at, archived_at, created_at, updated_at FROM task ORDER BY id;
SELECT id, conversation_id, created_at, updated_at FROM conversation;
SELECT profile_id, id, sequence, role, created_at FROM chat_message ORDER BY sequence;
SELECT a.profile_id, a.id, a.status, a.message_id, m.id AS linked_message, a.task_id, t.id AS linked_task
FROM chat_action a LEFT JOIN chat_message m ON m.id=a.message_id LEFT JOIN task t ON t.id=a.task_id;
SQL
```

Compare against known pre-backup counts/values, including archived task rows,
chat order/proposal payloads, profile ownership, and UTC timestamps. LLM keys
and database credentials remain deployment configuration, not profile settings.
The authentication migration retires old credential/session rows. Dumps from
older releases may still contain historical password hashes, so keep backups
private. Permanent task deletion does not purge prior backup snapshots.

## Disposable automated restore and credential audit

The committed opt-in smoke test uses a separate Compose file and fresh uniquely
named source/restore databases, with four distinct fake credential markers.
It migrates the actual source to Alembic head, seeds a historical credential residue,
seeds settings, active/archived tasks and linked chat proposals, produces custom
archives, and executes the restore wrapper above. It decodes the archive using
`pg_restore --file=-` into captured memory and checks all four plaintext markers
are absent; searching compressed bytes alone is insufficient. It verifies the
historical hash remains recoverable without printing it or any decoded content.
Full table snapshots, relationships, and UTC timestamps must match; source and
all retained archive SHA256 values must remain unchanged. Nine deterministic
completion days leave readable days 3–9. Missing/truncated inputs and a restore
into an already populated target must fail transactionally. Database and backup
containers are recreated without volume deletion and persistence is rechecked.

Use a **new project** for each run, and a free loopback port; never point this
harness at an existing project. `PLANORA_BACKUP_DOCKER_CONTEXT` optionally selects
an already running local context (e.g. `colima`) without changing global settings.
The following example uses the same default context for Compose and pytest.

```sh
docker compose -p planora45-smoke -f deploy/compose.test-backup.yml up -d --wait --build
cd apps/api
PLANORA_BACKUP_SMOKE_PROJECT=planora45-smoke python3 - <<'PY'
import fcntl, os, subprocess
with open(os.environ['PLANORA_SUITE_LOCK'], 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_SH)
    raise SystemExit(subprocess.call(['uv', 'run', 'pytest', 'tests/integration/test_deployment_backup_restore.py', '-v', '-s']))
PY
cd ../..
```

Use the agreed absolute host lock on your host; the path above is the macOS
checkout's agreed lock. All artifacts belong in repository `.tmp/`. If needed,
set `UV_CACHE_DIR` there when invoking `uv`. The smoke prints PostgreSQL version,
snapshot hash/counts and comparison results; retain that output for review.
The test drops only its two randomly named databases afterward. Its project's
seven successful archives remain until the operator reviews the evidence.
Cleanup **only the new disposable project**, after recording/reviewing results:

```sh
docker compose -p planora45-smoke -f deploy/compose.test-backup.yml down --volumes --remove-orphans
```

The `Compose stack (Docker)` CI job runs this smoke on every push against a
fresh `planora45-ci-<run id>` project and tears it down with the command above.
Never use that cleanup on the normal deployment. #44's separate
`compose.test-postgres.yml` remains the disposable migration/parity seam; #45's
smoke uses persistent volumes specifically to verify recreation persistence.
