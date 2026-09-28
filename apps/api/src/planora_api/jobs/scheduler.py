"""The hourly archive-job scheduler loop (spec §9.1, §19.2, issue #32).

Runs as its own process — the Compose `scheduler` service, #43 — never
inside an API worker: in-process scheduling would double-fire the job the
moment more than one worker runs. `Scheduler` is the injectable loop
(`now`, `clock`, `sleep` and `job` are all swappable) so
`tests/unit/test_scheduler.py` drives several iterations deterministically,
with no real waiting; `main` below is the thin process entry point that
wires it to the real clock, the real job and the process's signals.
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
import time
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Final

from sqlalchemy.orm import Session, sessionmaker

from planora_api.config import ConfigurationError, load_settings
from planora_api.db.session import create_session_factory
from planora_api.jobs.archive_done_tasks import ArchiveJobResult, archive_done_tasks
from planora_api.logging import configure_logging

logger = logging.getLogger("planora_api.jobs.scheduler")

# Pinned at grooming: a fixed module constant, not configuration — no
# operator-facing knob exists to change it.
ARCHIVE_INTERVAL_SECONDS: Final[float] = 3600.0


def _real_now() -> datetime:
    return datetime.now(UTC)


class Scheduler:
    """Runs `job` immediately, then again at most `interval_seconds` after
    the *previous run started* — never skipped and never overlapping
    within this process: if a run takes longer than the interval, the next
    one starts as soon as it finishes, and the loop is single-threaded, so
    two runs are never in flight at once.

    A run that raises is logged (`archive_job_failed`) and the loop
    continues on schedule; `archive_done_tasks` itself is responsible for
    its own `archive_job_completed` record on success.

    `stop()` (called from a signal handler, or directly in a test) ends
    the loop promptly: it never waits out the rest of a long interval,
    because the wait *is* `stop_event.wait(remaining)` by default, which a
    concurrent `.set()` interrupts immediately rather than only after
    `remaining` seconds.
    """

    def __init__(
        self,
        job: Callable[[datetime], ArchiveJobResult],
        *,
        now: Callable[[], datetime] = _real_now,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], object] | None = None,
        interval_seconds: float = ARCHIVE_INTERVAL_SECONDS,
        stop_event: threading.Event | None = None,
    ) -> None:
        self._job = job
        self._now = now
        self._clock = clock
        self._interval_seconds = interval_seconds
        self._stop_event = stop_event if stop_event is not None else threading.Event()
        # Default sleep is the stop event's own `wait` — a concurrent
        # `stop()` interrupts it immediately instead of only after the
        # full interval elapses (the "exits within 5 seconds when idle"
        # requirement). A test may still inject its own `sleep` to record
        # calls without any real wait at all.
        self._sleep = sleep if sleep is not None else self._stop_event.wait

    @property
    def stop_event(self) -> threading.Event:
        return self._stop_event

    def stop(self) -> None:
        self._stop_event.set()

    def run(self, *, max_iterations: int | None = None) -> int:
        """Run until `stop()` is called (or, for a test, until
        `max_iterations` runs have completed). Returns the number of
        iterations actually run."""
        iterations = 0
        while not self._stop_event.is_set():
            started_at = self._clock()
            try:
                self._job(self._now())
            except Exception as exc:  # noqa: BLE001 - a failed run must not kill the loop
                logger.error(
                    "archive_job_failed",
                    extra={
                        "error_type": type(exc).__name__,
                        "error_message": "The archive job failed.",
                    },
                )
            iterations += 1
            if self._stop_event.is_set():
                # A real stop request (signal, or a test's direct call)
                # always wins outright: never wait out any part of the
                # interval once asked to stop.
                break
            elapsed = self._clock() - started_at
            remaining = self._interval_seconds - elapsed
            if remaining > 0:
                self._sleep(remaining)
            if max_iterations is not None and iterations >= max_iterations:
                # Checked *after* the wait step, not instead of it, so a
                # test bounded by `max_iterations` still exercises the
                # same wait-after-each-run behavior production sees —
                # `max_iterations` only decides when to stop, never
                # whether a completed run waits.
                break
        return iterations


# --- Process entry point -----------------------------------------------------


def _build_arg_parser() -> argparse.ArgumentParser:
    return argparse.ArgumentParser(
        prog="python -m planora_api.jobs.scheduler",
        description="Run the archive-done-tasks job immediately, then hourly, until stopped.",
    )


def _install_signal_handlers(scheduler: Scheduler) -> None:
    def _handle_stop_signal(signum: int, frame: object) -> None:
        scheduler.stop()

    signal.signal(signal.SIGTERM, _handle_stop_signal)
    signal.signal(signal.SIGINT, _handle_stop_signal)


def main(argv: Sequence[str] | None = None) -> int:
    """Run the scheduler loop against `Settings.database_url` until
    `SIGTERM`/`SIGINT`, then return `0`. Returns `2` for invalid
    configuration or an unrecognized argument — the same convention as
    `jobs.archive_done_tasks.main`. Returns an `int` rather than calling
    `sys.exit` directly, matching that module, for the same in-process
    testing reason.
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

    session_factory: sessionmaker[Session] = create_session_factory(settings)
    scheduler = Scheduler(job=lambda now: archive_done_tasks(session_factory, now))
    _install_signal_handlers(scheduler)

    try:
        scheduler.run()
    finally:
        session_factory.kw["bind"].dispose()

    return 0


if __name__ == "__main__":  # pragma: no cover - process bootstrap, not importable
    sys.exit(main())
