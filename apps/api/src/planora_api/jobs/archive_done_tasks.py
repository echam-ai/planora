"""The archive-done-tasks job and its run-once command (spec §9.1, §19.2,
issue #32).

Archives every Done task whose seven-day window (`domain.archive_policy.
is_eligible_for_archive`) has elapsed as of the job's `now`. The eligibility
decision belongs entirely to that one function — this module never
re-derives the seven-day threshold.

**Concurrency.** The write phase is one transaction, all-or-nothing: if
anything raises partway, the whole run rolls back and no task from it is
left archived. Each write is conditional (`archived_at IS NULL AND status =
'done' AND completed_at = <the value this run read>`), so two overlapping
runs — a second scheduler process, or a run that outlasts the hourly
interval — can never double-archive a task or clobber each other's
`archived_at`, and a user moving a task out of Done between this run's read
and its write always wins. The read phase commits (releasing its locks)
*before* the write phase begins, deliberately: holding a read transaction
open on SQLite while a second connection also tries to write is the
deadlock `api.deps.get_session_factory`'s docstring warns about (two
connections each waiting on the other's lock). Ending the read cleanly
first — then starting a single, independent write transaction — avoids it
while keeping the writes themselves atomic.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from planora_api.config import ConfigurationError, load_settings
from planora_api.db import task_repository
from planora_api.db.models import Task, TaskStatus
from planora_api.db.session import create_session_factory, session_scope
from planora_api.domain.archive_policy import is_eligible_for_archive
from planora_api.logging import configure_logging

logger = logging.getLogger("planora_api.jobs.archive_done_tasks")


@dataclass(frozen=True)
class ArchiveJobResult:
    """The outcome of one `archive_done_tasks` run."""

    archived_count: int


def _archive_one(
    db: Session, task_id: uuid.UUID, completed_at: datetime, now: datetime
) -> bool:
    """Conditionally stamp one task's `archived_at`, guarding against a
    concurrent writer or a user's own move-out-of-Done: the `UPDATE` only
    applies if the row is still `archived_at IS NULL`, `status = 'done'`,
    and `completed_at` still equals the value this run read. Portable SQL
    only — no SQLite- or PostgreSQL-specific locking syntax — so the same
    guarantee holds on both (issue #44 runs this suite against PostgreSQL).

    `updated_at` is set to itself: pinned at grooming that archiving does
    not touch it. Without this, `Task.updated_at`'s `onupdate=_utc_now`
    (`db/models.py`) would fire automatically — Core `update()` applies a
    column's `onupdate` default to any column its `.values()` leaves
    unmentioned, exactly like an ORM-issued `UPDATE` would. Naming it
    explicitly, set to its own current column value, is what suppresses
    that default.

    Returns whether this call's write actually took effect. A module-level
    function (not a closure) so a test can monkeypatch it directly to
    simulate a race between this run's read and its write.
    """
    stmt = (
        update(Task)
        .where(
            Task.id == task_id,
            Task.archived_at.is_(None),
            Task.status == TaskStatus.DONE,
            Task.completed_at == completed_at,
        )
        .values(archived_at=now, updated_at=Task.updated_at)
    )
    result = db.execute(stmt)
    return result.rowcount == 1


def archive_done_tasks(
    session_factory: sessionmaker[Session],
    now: datetime,
    *,
    on_before_writes: Callable[[], None] | None = None,
) -> ArchiveJobResult:
    """Run the job once: archive every currently-eligible Done task.

    `now` is a required parameter — this function never reads the clock
    itself; only the command-line entry points below do. Raises
    `ValueError` for a naive `now`, matching
    `domain.archive_policy.is_eligible_for_archive`.

    `on_before_writes`, if given, is called exactly once, after the read
    phase has committed and before the first write — the seam
    `tests/integration/test_archive_job_concurrency.py` uses to
    synchronize two real concurrent runs on a barrier, proving genuine
    overlap rather than an accidentally-sequential test.
    """
    if now.tzinfo is None:
        raise ValueError("now must be a timezone-aware datetime, not a naive one")

    started = time.perf_counter()
    with session_scope(session_factory) as session:
        candidates = task_repository.list_done_unarchived_tasks(session)
        # Extract plain values now, while they're fresh — `session.commit()`
        # just below expires every loaded ORM object (`expire_on_commit=
        # True`, `db/session.py`), so touching `task.completed_at` again
        # after it would trigger a surprise reload reflecting whatever the
        # row looks like *now*, not the value this run actually read.
        eligible: list[tuple[uuid.UUID, datetime]] = [
            (task.id, task.completed_at)
            for task in candidates
            if is_eligible_for_archive(task.status, task.completed_at, now)
        ]

        # End the read-only transaction here, before any write — see the
        # module docstring for why this ordering matters for concurrent
        # runs on SQLite.
        session.commit()

        if on_before_writes is not None:
            on_before_writes()

        archived_count = 0
        for task_id, completed_at in eligible:
            if _archive_one(session, task_id, completed_at, now):
                archived_count += 1
        # `session_scope` commits this write phase on a clean exit.

    duration_ms = round((time.perf_counter() - started) * 1000, 3)
    logger.info(
        "archive_job_completed",
        extra={
            "now": now.isoformat(),
            "archived_count": archived_count,
            "duration_ms": duration_ms,
        },
    )
    return ArchiveJobResult(archived_count=archived_count)


# --- Run-once command --------------------------------------------------------


def _build_arg_parser() -> argparse.ArgumentParser:
    return argparse.ArgumentParser(
        prog="python -m planora_api.jobs.archive_done_tasks",
        description="Archive every Done task whose seven-day window has elapsed, then exit.",
    )


def main(argv: Sequence[str] | None = None) -> int:
    """Run the job once against `Settings.database_url` and return an exit
    code: `0` on success (including zero tasks archived), `1` if the run
    itself fails (e.g. migrations were never applied), `2` for invalid
    configuration or an unrecognized argument.

    Returns an `int` rather than calling `sys.exit` directly, so a test can
    call this in-process and assert the code without catching `SystemExit`
    — `if __name__ == "__main__":` below is the only place that exits the
    process.
    """
    parser = _build_arg_parser()
    try:
        parser.parse_args(argv)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2

    try:
        settings = load_settings()
    except ConfigurationError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    configure_logging(
        level=settings.log_level,
        secrets=(settings.session_secret, settings.llm_api_key, settings.database_url),
    )

    session_factory = create_session_factory(settings)
    try:
        archive_done_tasks(session_factory, datetime.now(UTC))
    except Exception as exc:  # noqa: BLE001 - turned into exit code 1, never re-raised
        # Never the traceback: it could carry task content or a value from
        # a DATABASE_URL query string. Only the exception's type and a
        # fixed, safe message.
        logger.error(
            "archive_job_failed",
            extra={"error_type": type(exc).__name__, "error_message": "The archive job failed."},
        )
        return 1
    finally:
        session_factory.kw["bind"].dispose()

    return 0


if __name__ == "__main__":  # pragma: no cover - process bootstrap, not importable
    sys.exit(main())
