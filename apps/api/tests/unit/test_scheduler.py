"""Unit tests for `planora_api.jobs.scheduler.Scheduler` (issue #32).

Pure — no database, no real waiting beyond a bounded `Thread.join`/`Event.
wait` in the two tests that genuinely need a second thread. Every other
test injects `now`, `clock`, `sleep` and `job` so the loop advances
instantly and deterministically.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import UTC, datetime

import pytest

from planora_api.jobs.archive_done_tasks import ArchiveJobResult
from planora_api.jobs.scheduler import ARCHIVE_INTERVAL_SECONDS, Scheduler, _real_now

FIXED_NOW = datetime(2026, 3, 1, tzinfo=UTC)


def _no_sleep(_seconds: float) -> None:
    """A `sleep` that never actually waits — used by every test that only
    cares about call counts/arguments, not real timing."""


def test_runs_the_job_immediately_before_any_wait() -> None:
    calls: list[datetime] = []

    def job(now: datetime) -> ArchiveJobResult:
        calls.append(now)
        return ArchiveJobResult(archived_count=0)

    scheduler = Scheduler(
        job, now=lambda: FIXED_NOW, clock=lambda: 0.0, sleep=_no_sleep
    )
    scheduler.run(max_iterations=1)

    assert calls == [FIXED_NOW]


def test_sleeps_for_the_remainder_of_the_interval_after_a_fast_run() -> None:
    sleeps: list[float] = []
    # Two monotonic reads per iteration: one at start, one after the job.
    clock_values = iter([100.0, 100.0 + 5.0])

    scheduler = Scheduler(
        lambda now: ArchiveJobResult(archived_count=0),
        now=lambda: FIXED_NOW,
        clock=lambda: next(clock_values),
        sleep=sleeps.append,
        interval_seconds=3600.0,
    )
    scheduler.run(max_iterations=1)

    assert sleeps == [3600.0 - 5.0]


def test_does_not_sleep_and_starts_the_next_run_immediately_when_a_run_overruns_the_interval() -> None:
    sleeps: list[float] = []
    job_calls: list[int] = []
    # Iteration 1: starts at 0, job takes 4000s (> the 3600s interval).
    # Iteration 2: starts at 4000, job takes 1s.
    clock_values = iter([0.0, 4000.0, 4000.0, 4001.0])

    def job(now: datetime) -> ArchiveJobResult:
        job_calls.append(1)
        return ArchiveJobResult(archived_count=0)

    scheduler = Scheduler(
        job,
        now=lambda: FIXED_NOW,
        clock=lambda: next(clock_values),
        sleep=sleeps.append,
        interval_seconds=3600.0,
    )
    scheduler.run(max_iterations=2)

    assert len(job_calls) == 2
    # No sleep after the overrunning first run; the normal remainder after
    # the fast second run.
    assert sleeps == [3600.0 - 1.0]


def test_default_interval_constant_is_3600_seconds() -> None:
    assert ARCHIVE_INTERVAL_SECONDS == 3600.0


def test_real_now_returns_an_aware_utc_datetime_close_to_now() -> None:
    before = datetime.now(UTC)
    value = _real_now()
    after = datetime.now(UTC)
    assert value.tzinfo is not None
    assert before <= value <= after


def test_stop_called_by_the_job_itself_skips_the_trailing_wait() -> None:
    # Simulates a signal arriving *during* the run (not during the wait
    # that follows it): the job calls stop(), and the loop must notice
    # right away rather than still computing/using a wait duration.
    sleeps: list[float] = []
    scheduler: Scheduler

    def stopping_job(now: datetime) -> ArchiveJobResult:
        scheduler.stop()
        return ArchiveJobResult(archived_count=0)

    scheduler = Scheduler(
        stopping_job, now=lambda: FIXED_NOW, clock=lambda: 0.0, sleep=sleeps.append
    )
    iterations = scheduler.run()

    assert iterations == 1
    assert sleeps == []


def test_a_failing_run_is_logged_and_the_loop_continues_to_the_next_scheduled_run(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.ERROR, logger="planora_api.jobs.scheduler")
    call_count = {"n": 0}

    def flaky_job(now: datetime) -> ArchiveJobResult:
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("boom")
        return ArchiveJobResult(archived_count=0)

    scheduler = Scheduler(
        flaky_job, now=lambda: FIXED_NOW, clock=lambda: 0.0, sleep=_no_sleep
    )
    iterations = scheduler.run(max_iterations=2)

    assert iterations == 2
    assert call_count["n"] == 2
    failed_records = [r for r in caplog.records if r.message == "archive_job_failed"]
    assert len(failed_records) == 1
    assert failed_records[0].error_type == "RuntimeError"


def test_stop_called_before_run_means_the_job_never_runs() -> None:
    calls: list[int] = []
    scheduler = Scheduler(
        lambda now: calls.append(1) or ArchiveJobResult(archived_count=0),
        now=lambda: FIXED_NOW,
        clock=lambda: 0.0,
        sleep=_no_sleep,
    )
    scheduler.stop()
    iterations = scheduler.run()

    assert iterations == 0
    assert calls == []


def test_max_iterations_bounds_the_loop_without_requiring_stop() -> None:
    call_count = {"n": 0}

    def job(now: datetime) -> ArchiveJobResult:
        call_count["n"] += 1
        return ArchiveJobResult(archived_count=0)

    scheduler = Scheduler(
        job, now=lambda: FIXED_NOW, clock=lambda: 0.0, sleep=_no_sleep
    )
    iterations = scheduler.run(max_iterations=3)

    assert iterations == 3
    assert call_count["n"] == 3


# --- Real interruption: stop() during a wait returns promptly ---------------


def test_stop_called_from_another_thread_during_a_long_wait_interrupts_it_promptly() -> None:
    # A genuinely long interval (1 real hour) so this test only passes if
    # `stop()` actually interrupts the wait rather than the loop merely
    # finishing on its own. `Event.wait` (the real default `sleep`) is a
    # blocking call that a concurrent `.set()` wakes immediately — no
    # `time.sleep` anywhere in this test.
    scheduler = Scheduler(
        lambda now: ArchiveJobResult(archived_count=0),
        now=lambda: FIXED_NOW,
        clock=time.monotonic,
        interval_seconds=3600.0,
    )

    result: dict[str, int] = {}

    def run_loop() -> None:
        result["iterations"] = scheduler.run()

    thread = threading.Thread(target=run_loop)
    started = time.monotonic()
    thread.start()
    # Let the first (immediate) run happen and the loop enter its wait.
    while not scheduler.stop_event.wait(timeout=0) and "iterations" not in result:
        if time.monotonic() - started > 2.0:
            break
    scheduler.stop()
    thread.join(timeout=5.0)
    elapsed = time.monotonic() - started

    assert not thread.is_alive()
    assert elapsed < 5.0
    assert result["iterations"] == 1


def test_run_within_one_process_never_overlaps_even_with_a_slow_job() -> None:
    # A job that blocks briefly, verified via an in-flight counter that
    # must never exceed 1 — proves the loop is strictly sequential.
    in_flight = {"n": 0, "max": 0}
    lock = threading.Lock()

    def job(now: datetime) -> ArchiveJobResult:
        with lock:
            in_flight["n"] += 1
            in_flight["max"] = max(in_flight["max"], in_flight["n"])
        time.sleep(0.05)
        with lock:
            in_flight["n"] -= 1
        return ArchiveJobResult(archived_count=0)

    scheduler = Scheduler(
        job, now=lambda: FIXED_NOW, clock=lambda: 0.0, sleep=_no_sleep
    )
    scheduler.run(max_iterations=3)

    assert in_flight["max"] == 1
