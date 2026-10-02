"""Daily 03:00 application-timezone PostgreSQL dumps; --once uses the same job."""
from __future__ import annotations

import argparse
import fcntl
import logging
import os
import re
import signal
import subprocess
import threading
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

logger = logging.getLogger("planora.backup")


def next_run(now: datetime, timezone: ZoneInfo) -> datetime:
    local = now.astimezone(timezone)
    candidate = local.replace(hour=3, minute=0, second=0, microsecond=0)
    if candidate.astimezone(UTC) <= now.astimezone(UTC):
        candidate += timedelta(days=1)
    return candidate.astimezone(UTC)


# Lexical UTC completion identity; recognizes #43's second-resolution names too.
DUMP_NAME = re.compile(r"planora-\d{8}T\d{6}(?:\d{6})?Z-[0-9a-f]{8,32}\.dump")


def sync_directory(directory: Path) -> None:
    fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def run_backup(directory: Path, *, runner=subprocess.run,
               now=lambda: datetime.now(UTC)) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    # Serialize manual and scheduled jobs sharing this volume. Never unlink the
    # lock: another process may already hold its inode open.
    with (directory / ".backup.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        temporary = directory / f"{uuid.uuid4().hex}.partial"
        temporary.touch(mode=0o600, exist_ok=False)
        try:
            runner(["pg_dump", "--format=custom", "--no-password", "--file", str(temporary)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if temporary.stat().st_size == 0:
                raise RuntimeError("pg_dump produced an empty dump")
            with temporary.open("rb") as dump:
                os.fsync(dump.fileno())
            stamp = now().astimezone(UTC).strftime("%Y%m%dT%H%M%S%fZ")
            target = directory / f"planora-{stamp}-{uuid.uuid4().hex}.dump"
            temporary.replace(target)
            sync_directory(directory)
        finally:
            temporary.unlink(missing_ok=True)
        # Only safely published, recognized recovery points count. Unrelated
        # files and leftovers from a hard kill are never candidates.
        dumps = sorted(p for p in directory.iterdir()
                       if DUMP_NAME.fullmatch(p.name) and p.is_file())
        for expired in dumps[:-7]:
            expired.unlink()
        sync_directory(directory)
    logger.info("backup_completed file=%s bytes=%d", target.name, target.stat().st_size)
    return target


def restore_backup(backup: Path, database: str, *, runner=subprocess.run) -> None:
    """Restore transactionally into an explicitly selected fresh database."""
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", database) or database == os.environ.get("PGDATABASE"):
        raise ValueError("Select a separate explicit restore database")
    with backup.open("rb") as dump:
        if not dump.read(1):
            raise ValueError("Backup is empty")
    # No --clean/--create: existing application tables fail rather than being
    # replaced. Any tool/data failure rolls the entire restore back.
    runner(["pg_restore", "--no-password", "--exit-on-error", "--single-transaction",
            "--no-owner", "--no-acl", "--dbname", database, str(backup)],
           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    logger.info("restore_completed file=%s", backup.name)


class BackupWorker:
    def __init__(self, directory: Path, timezone: ZoneInfo, stop: threading.Event,
                 *, operation=run_backup, now=lambda: datetime.now(UTC)):
        self.directory, self.timezone, self.stop = directory, timezone, stop
        self.operation, self.now = operation, now

    def run(self) -> None:
        while not self.stop.is_set():
            due = next_run(self.now(), self.timezone)
            logger.info("backup_scheduled next_run=%s timezone=%s", due.isoformat(), self.timezone.key)
            while not self.stop.is_set() and self.now() < due:
                # Re-evaluate wall time so clock adjustments do not lock the
                # worker to a stale delay; SIGTERM interrupts the wait at once.
                self.stop.wait(min(60, max(0, (due - self.now()).total_seconds())))
            if self.stop.is_set():
                break
            try:
                self.operation(self.directory)
            except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
                logger.error("backup_failed error_type=%s", type(exc).__name__)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--once", action="store_true")
    group.add_argument("--restore", type=Path, metavar="BACKUP")
    parser.add_argument("--database", help="Explicit fresh restore target")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if args.restore and not args.database:
        parser.error("--restore requires --database")
    if args.database and not args.restore:
        parser.error("--database requires --restore")
    required = ("PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD")
    if not args.restore:
        required += ("DEFAULT_TIMEZONE",)
    missing = [key for key in required if not os.environ.get(key, "").strip()]
    if missing:
        logger.error("Missing configuration: %s", ", ".join(missing))
        return 2
    if args.restore:
        try:
            restore_backup(args.restore, args.database)
        except (OSError, ValueError, subprocess.CalledProcessError) as exc:
            logger.error("restore_failed error_type=%s", type(exc).__name__)
            return 1
        return 0
    try:
        timezone = ZoneInfo(os.environ["DEFAULT_TIMEZONE"])
    except (ValueError, KeyError):
        logger.error("DEFAULT_TIMEZONE must be an IANA timezone")
        return 2
    directory = Path("/backups")
    if args.once:
        try:
            run_backup(directory)
        except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
            logger.error("backup_failed error_type=%s", type(exc).__name__)
            return 1
        return 0
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    BackupWorker(directory, timezone, stop).run()
    logger.info("backup_stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
