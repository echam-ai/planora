"""Daily 03:00 application-timezone PostgreSQL dumps; --once uses the same job."""
from __future__ import annotations

import argparse
import logging
import os
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


def run_backup(directory: Path, *, runner=subprocess.run) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    target = directory / f"planora-{stamp}-{uuid.uuid4().hex[:8]}.dump"
    temporary = target.with_suffix(".partial")
    # Credentials stay in libpq's process environment, never command arguments
    # or logs. Publish a dump only after pg_dump succeeds with nonempty output.
    temporary.touch(mode=0o600, exist_ok=False)
    try:
        runner(["pg_dump", "--format=custom", "--no-password", "--file", str(temporary)],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if temporary.stat().st_size == 0:
            raise RuntimeError("pg_dump produced an empty dump")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    logger.info("backup_completed file=%s bytes=%d", target.name, target.stat().st_size)
    return target


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
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    required = ("PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD", "DEFAULT_TIMEZONE")
    missing = [key for key in required if not os.environ.get(key, "").strip()]
    if missing:
        logger.error("Missing configuration: %s", ", ".join(missing))
        return 2
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
