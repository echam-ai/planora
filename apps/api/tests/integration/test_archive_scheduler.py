"""Integration tests for `planora_api.jobs.scheduler` (issue #32):
`main`'s config-error/argument exit codes, and the real
`archive_done_tasks` job driven through a real `Scheduler` against a
migrated database — proving the two modules actually work together, not
just each in isolation against a fake.
"""

from __future__ import annotations

import logging
import os
import signal
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import VALID_ENV
from sqlalchemy.orm import Session, sessionmaker

from planora_api.db.models import Task, TaskCategory, TaskPriority, TaskStatus
from planora_api.jobs.archive_done_tasks import archive_done_tasks
from planora_api.jobs.scheduler import Scheduler, _install_signal_handlers, main

SEVEN_DAYS = timedelta(days=7)


def _seed_task(
    session_factory: sessionmaker[Session], **overrides: Any
) -> uuid.UUID:
    defaults: dict[str, Any] = {
        "title": "Task",
        "content": "Content",
        "status": TaskStatus.TODO,
        "category": TaskCategory.WORK,
        "priority": TaskPriority.MEDIUM,
        "position": 1.0,
    }
    defaults.update(overrides)
    with session_factory() as session:
        task = Task(**defaults)
        session.add(task)
        session.commit()
        return task.id


# --- main(): config/argument exit codes -------------------------------------


def test_exit_2_with_message_naming_the_variable_on_invalid_configuration(
    clean_env: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    for name, value in VALID_ENV.items():
        if name != "LLM_API_KEY":
            clean_env.setenv(name, value)

    code = main([])

    assert code == 2
    captured = capsys.readouterr()
    assert "LLM_API_KEY" in captured.err


def test_exit_2_for_an_unrecognized_argument(valid_env: pytest.MonkeyPatch) -> None:
    assert main(["--not-a-real-flag"]) == 2


# --- Real job through a real Scheduler ---------------------------------------


def test_a_failing_run_followed_by_a_succeeding_one_logs_both_and_the_second_archives(
    migrated_session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    task_id = _seed_task(
        migrated_session_factory,
        status=TaskStatus.DONE,
        completed_at=datetime(2026, 3, 1, tzinfo=UTC) - SEVEN_DAYS,
    )
    call_count = {"n": 0}

    def flaky_then_real_job(now: datetime) -> Any:
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise RuntimeError("simulated first-run failure")
        return archive_done_tasks(migrated_session_factory, now)

    caplog.set_level(logging.INFO)
    scheduler = Scheduler(
        flaky_then_real_job,
        now=lambda: datetime(2026, 3, 1, tzinfo=UTC),
        clock=lambda: 0.0,
        sleep=lambda _seconds: None,
    )
    iterations = scheduler.run(max_iterations=2)

    assert iterations == 2
    failed = [r for r in caplog.records if r.message == "archive_job_failed"]
    completed = [r for r in caplog.records if r.message == "archive_job_completed"]
    assert len(failed) == 1
    assert len(completed) == 1
    assert completed[0].archived_count == 1

    with migrated_session_factory() as session:
        task = session.get(Task, task_id)
        assert task is not None
        assert task.archived_at is not None


# --- Signal wiring: SIGTERM/SIGINT stop the loop -----------------------------


def test_install_signal_handlers_makes_sigterm_and_sigint_call_stop() -> None:
    """Proves the signal-to-`stop()` wiring directly, by sending real
    signals to this test process, rather than only trusting a subprocess
    end-to-end run — which would need the full 3600s interval (or a
    process restart to change it) to prove the same thing and would be
    real-clock-slow either way."""
    original_term = signal.getsignal(signal.SIGTERM)
    original_int = signal.getsignal(signal.SIGINT)
    try:
        scheduler_a = Scheduler(lambda now: None)
        _install_signal_handlers(scheduler_a)
        assert not scheduler_a.stop_event.is_set()
        os.kill(os.getpid(), signal.SIGTERM)
        assert scheduler_a.stop_event.is_set()

        scheduler_b = Scheduler(lambda now: None)
        _install_signal_handlers(scheduler_b)
        os.kill(os.getpid(), signal.SIGINT)
        assert scheduler_b.stop_event.is_set()
    finally:
        signal.signal(signal.SIGTERM, original_term)
        signal.signal(signal.SIGINT, original_int)


def test_stop_during_a_wait_lets_the_loop_exit_promptly_when_idle() -> None:
    # A real (long) interval, proving `stop()` interrupts the wait rather
    # than the loop happening to finish quickly on its own — no
    # `time.sleep` used to synchronize; the assertion is on wall-clock
    # elapsed time via a bounded `Thread.join`.
    calls: list[int] = []
    scheduler = Scheduler(
        lambda now: calls.append(1),
        now=lambda: datetime(2026, 3, 1, tzinfo=UTC),
        interval_seconds=3600.0,
    )

    result: dict[str, int] = {}

    def run_loop() -> None:
        result["iterations"] = scheduler.run()

    thread = threading.Thread(target=run_loop)
    started = time.monotonic()
    thread.start()
    # Give the immediate first run a moment to happen and the loop to
    # enter its wait — bounded, not a fixed real sleep over 1s.
    deadline = started + 2.0
    while not calls and time.monotonic() < deadline:
        pass
    scheduler.stop()
    thread.join(timeout=5.0)
    elapsed = time.monotonic() - started

    assert not thread.is_alive()
    assert elapsed < 5.0
    assert result["iterations"] == 1
    assert calls == [1]


def test_main_happy_path_runs_immediately_and_sigterm_stops_it_promptly(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
) -> None:
    """Exercises `main()`'s real happy path end to end — real config, real
    logging setup, a real `Scheduler` wrapping the real `archive_done_
    tasks`, and a real `SIGTERM` — rather than only its config-error exit
    codes and the `Scheduler`/signal-wiring pieces tested in isolation
    above. Signal handlers must be installed from the main thread (a
    Python restriction), so `main()` itself runs here in the test's main
    thread; a background thread polls the database (bounded, not a fixed
    sleep) for the seeded task's `archived_at` to confirm the job actually
    ran, then sends the real signal that stops it.
    """
    task_id = _seed_task(
        migrated_session_factory,
        status=TaskStatus.DONE,
        completed_at=datetime.now(UTC) - SEVEN_DAYS - timedelta(hours=1),
    )

    def send_sigterm_once_the_task_is_archived() -> None:
        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            with migrated_session_factory() as session:
                task = session.get(Task, task_id)
                if task is not None and task.archived_at is not None:
                    break
        os.kill(os.getpid(), signal.SIGTERM)

    original_term = signal.getsignal(signal.SIGTERM)
    original_int = signal.getsignal(signal.SIGINT)
    trigger_thread = threading.Thread(target=send_sigterm_once_the_task_is_archived)
    try:
        trigger_thread.start()
        started = time.monotonic()
        code = main([])
        elapsed = time.monotonic() - started
    finally:
        trigger_thread.join(timeout=5.0)
        signal.signal(signal.SIGTERM, original_term)
        signal.signal(signal.SIGINT, original_int)

    assert code == 0
    assert elapsed < 5.0
    with migrated_session_factory() as session:
        task = session.get(Task, task_id)
        assert task is not None
        assert task.archived_at is not None
