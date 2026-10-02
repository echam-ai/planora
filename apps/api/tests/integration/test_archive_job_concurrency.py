"""Concurrency tests for `planora_api.jobs.archive_done_tasks.archive_done_tasks`
(issue #32).

Two kinds of test here:

- **Overlap** — two *real* concurrent runs against the same SQLite file
  database, each with its own engine/session (mimicking two separate
  scheduler processes). Synchronized deterministically with a
  `threading.Barrier`, not a sleep: both threads finish their read phase
  and release its lock (`archive_done_tasks` commits the read before any
  write — see that module's docstring) before either starts writing, so
  the two write phases genuinely overlap rather than happening to run
  sequentially by luck of the scheduler.
- **Race** — a single run, with `_archive_one` monkeypatched to mutate the
  target row (in the *same* session/transaction) between the read and the
  write, simulating a user's own move-out-of-Done landing in between. No
  threads needed for this one; the acceptance criteria explicitly allow
  "a hook or monkeypatch" here.

Both avoid the SQLite deadlock `api.deps.get_session_factory`'s docstring
warns about (one connection's open read transaction blocking a second
connection's write, and vice versa) precisely because the job's read phase
commits before its write phase begins.
"""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session, sessionmaker

from planora_api.db.models import Task, TaskCategory, TaskPriority, TaskStatus
from planora_api.jobs import archive_done_tasks as job_module
from planora_api.jobs.archive_done_tasks import archive_done_tasks

NOW = datetime(2026, 3, 8, 12, 0, 0, tzinfo=UTC)
SEVEN_DAYS = timedelta(days=7)
ELIGIBLE_COMPLETED_AT = NOW - SEVEN_DAYS


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


def _get_task(session_factory: sessionmaker[Session], task_id: uuid.UUID) -> Task:
    with session_factory() as session:
        task = session.get(Task, task_id)
        assert task is not None
        return task


# --- Overlap: two real concurrent runs on one SQLite file -------------------


def test_two_concurrent_runs_never_double_archive_and_counts_sum_to_the_total(
    migrated_database_url: str,
) -> None:
    task_count = 50
    engine_a = create_engine(migrated_database_url)
    engine_b = create_engine(migrated_database_url)
    factory_a = sessionmaker(bind=engine_a, autoflush=False, expire_on_commit=True)
    factory_b = sessionmaker(bind=engine_b, autoflush=False, expire_on_commit=True)

    task_ids = [
        _seed_task(
            factory_a, status=TaskStatus.DONE, completed_at=ELIGIBLE_COMPLETED_AT
        )
        for _ in range(task_count)
    ]

    barrier = threading.Barrier(2)
    outcomes: dict[str, Any] = {}
    errors: list[BaseException] = []

    def run(name: str, factory: sessionmaker[Session]) -> None:
        try:
            outcomes[name] = archive_done_tasks(
                factory, NOW, on_before_writes=lambda: barrier.wait(timeout=10)
            )
        except BaseException as exc:  # noqa: BLE001 - captured for the assertion below
            errors.append(exc)

    thread_a = threading.Thread(target=run, args=("a", factory_a))
    thread_b = threading.Thread(target=run, args=("b", factory_b))
    thread_a.start()
    thread_b.start()
    thread_a.join(timeout=15)
    thread_b.join(timeout=15)

    try:
        assert not thread_a.is_alive()
        assert not thread_b.is_alive()
        assert not errors, f"a run raised: {errors!r}"
        assert outcomes["a"].archived_count + outcomes["b"].archived_count == task_count

        with factory_a() as check_session:
            rows = list(
                check_session.execute(
                    select(Task).where(Task.id.in_(task_ids))
                ).scalars()
            )
            assert len(rows) == task_count
            for row in rows:
                assert row.archived_at == NOW
    finally:
        engine_a.dispose()
        engine_b.dispose()


# --- Race: a task moved out of Done between read and write ------------------


def test_task_moved_out_of_done_between_read_and_write_is_not_archived(
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task_id = _seed_task(
        migrated_session_factory,
        status=TaskStatus.DONE,
        completed_at=ELIGIBLE_COMPLETED_AT,
    )
    real_archive_one = job_module._archive_one

    def racing_archive_one(
        db: Session, target_id: uuid.UUID, completed_at: datetime, now: datetime
    ) -> bool:
        # Simulates the user moving the task out of Done in the gap
        # between this run's read and its write — landing in the same
        # transaction, immediately before the real conditional write.
        db.execute(
            update(Task).where(Task.id == target_id).values(status=TaskStatus.TODO)
        )
        return real_archive_one(db, target_id, completed_at, now)

    monkeypatch.setattr(job_module, "_archive_one", racing_archive_one)

    result = archive_done_tasks(migrated_session_factory, NOW)

    assert result.archived_count == 0
    task = _get_task(migrated_session_factory, task_id)
    assert task.archived_at is None
    assert task.status == TaskStatus.TODO


# --- All-or-nothing: a failure partway leaves nothing archived --------------


def test_a_failure_partway_through_the_write_phase_leaves_nothing_archived(
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_id = _seed_task(
        migrated_session_factory,
        status=TaskStatus.DONE,
        completed_at=ELIGIBLE_COMPLETED_AT,
        title="First",
    )
    second_id = _seed_task(
        migrated_session_factory,
        status=TaskStatus.DONE,
        completed_at=ELIGIBLE_COMPLETED_AT,
        title="Second",
    )
    real_archive_one = job_module._archive_one
    call_count = {"n": 0}

    def failing_after_first(
        db: Session, target_id: uuid.UUID, completed_at: datetime, now: datetime
    ) -> bool:
        call_count["n"] += 1
        if call_count["n"] == 2:
            raise RuntimeError("simulated failure after the first write")
        return real_archive_one(db, target_id, completed_at, now)

    monkeypatch.setattr(job_module, "_archive_one", failing_after_first)

    with pytest.raises(RuntimeError, match="simulated failure"):
        archive_done_tasks(migrated_session_factory, NOW)

    # Neither task is archived — the first write, though it happened,
    # rolled back with everything else in the same transaction.
    first = _get_task(migrated_session_factory, first_id)
    second = _get_task(migrated_session_factory, second_id)
    assert first.archived_at is None
    assert second.archived_at is None
    assert {first_id, second_id} == {first_id, second_id}
