"""Integration tests for `planora_api.jobs.archive_done_tasks.archive_done_tasks`
(issue #32, spec §9.1).

Follows the pattern in `tests/integration/test_archive.py`: `migrated_
session_factory` for a disposable SQLite database, tasks seeded by setting
fields directly (no HTTP layer — the job itself never goes through the
HTTP API, per #26's grooming note).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import AUTH_PASSWORD, AUTH_USERNAME, make_client
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.db.models import Task, TaskCategory, TaskPriority, TaskStatus
from planora_api.jobs import archive_done_tasks as job_module
from planora_api.jobs.archive_done_tasks import archive_done_tasks

NOW = datetime(2026, 3, 8, 12, 0, 0, tzinfo=UTC)
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


def _get_task(session_factory: sessionmaker[Session], task_id: uuid.UUID) -> Task:
    with session_factory() as session:
        task = session.get(Task, task_id)
        assert task is not None
        return task


def _all_tasks(session_factory: sessionmaker[Session]) -> list[Task]:
    with session_factory() as session:
        return list(session.execute(select(Task)).scalars().all())


# --- Eligibility --------------------------------------------------------


def test_spy_shows_is_eligible_for_archive_is_called_for_each_candidate(
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    done_id = _seed_task(
        migrated_session_factory, status=TaskStatus.DONE, completed_at=NOW - SEVEN_DAYS
    )
    other_done_id = _seed_task(
        migrated_session_factory, status=TaskStatus.DONE, completed_at=NOW
    )
    calls: list[tuple[Any, Any, Any]] = []
    real = job_module.is_eligible_for_archive

    def spy(status: Any, completed_at: Any, now: Any) -> bool:
        calls.append((status, completed_at, now))
        return real(status, completed_at, now)

    monkeypatch.setattr(job_module, "is_eligible_for_archive", spy)

    archive_done_tasks(migrated_session_factory, NOW)

    called_ids = {c[1] for c in calls}
    # Called with each candidate's completed_at — proves it ran once per
    # Done/unarchived task, not skipped or short-circuited.
    assert len(calls) == 2
    seeded_completed_ats = {NOW - SEVEN_DAYS, NOW}
    assert called_ids == seeded_completed_ats
    assert {done_id, other_done_id}  # both tasks exist (sanity)


def test_task_exactly_seven_days_done_is_archived(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(
        migrated_session_factory, status=TaskStatus.DONE, completed_at=NOW - SEVEN_DAYS
    )
    result = archive_done_tasks(migrated_session_factory, NOW)
    assert result.archived_count == 1
    assert _get_task(migrated_session_factory, task_id).archived_at == NOW


@pytest.mark.parametrize("delta", [timedelta(seconds=1), timedelta(microseconds=1)])
def test_task_just_under_seven_days_is_not_archived(
    migrated_session_factory: sessionmaker[Session], delta: timedelta
) -> None:
    task_id = _seed_task(
        migrated_session_factory,
        status=TaskStatus.DONE,
        completed_at=NOW - SEVEN_DAYS + delta,
    )
    result = archive_done_tasks(migrated_session_factory, NOW)
    assert result.archived_count == 0
    assert _get_task(migrated_session_factory, task_id).archived_at is None


@pytest.mark.parametrize("status", [TaskStatus.TODO, TaskStatus.IN_PROGRESS])
def test_non_done_task_is_never_archived_even_with_an_old_completed_at(
    migrated_session_factory: sessionmaker[Session], status: TaskStatus
) -> None:
    task_id = _seed_task(
        migrated_session_factory, status=status, completed_at=NOW - timedelta(days=30)
    )
    result = archive_done_tasks(migrated_session_factory, NOW)
    assert result.archived_count == 0
    assert _get_task(migrated_session_factory, task_id).archived_at is None


def test_done_task_with_null_completed_at_is_not_archived_and_run_does_not_fail(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(
        migrated_session_factory, status=TaskStatus.DONE, completed_at=None
    )
    result = archive_done_tasks(migrated_session_factory, NOW)
    assert result.archived_count == 0
    assert _get_task(migrated_session_factory, task_id).archived_at is None


def test_restored_task_is_never_re_archived(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    # Mirrors what POST /api/v1/archive/{id}/restore actually leaves behind
    # (#30): status todo, completed_at and archived_at both null.
    task_id = _seed_task(
        migrated_session_factory,
        status=TaskStatus.TODO,
        completed_at=None,
        archived_at=None,
    )
    result = archive_done_tasks(migrated_session_factory, NOW + timedelta(days=365))
    assert result.archived_count == 0
    task = _get_task(migrated_session_factory, task_id)
    assert task.archived_at is None
    assert task.status == TaskStatus.TODO


def test_task_recompleted_after_leaving_done_uses_the_new_completed_at(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    # Completed 10 days ago, moved out of Done (completed_at cleared by
    # #28's rule), then moved back into Done 1 day ago (new completed_at).
    new_completed_at = NOW - timedelta(days=1)
    task_id = _seed_task(
        migrated_session_factory, status=TaskStatus.DONE, completed_at=new_completed_at
    )
    result = archive_done_tasks(migrated_session_factory, NOW)
    assert result.archived_count == 0
    assert _get_task(migrated_session_factory, task_id).archived_at is None

    later = new_completed_at + SEVEN_DAYS
    result = archive_done_tasks(migrated_session_factory, later)
    assert result.archived_count == 1
    assert _get_task(migrated_session_factory, task_id).archived_at == later


# --- What archiving does -------------------------------------------------


def test_archived_task_keeps_every_other_field_unchanged(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    completed_at = NOW - SEVEN_DAYS
    task_id = _seed_task(
        migrated_session_factory,
        title="Keep me",
        content="Body",
        status=TaskStatus.DONE,
        category=TaskCategory.PERSONAL,
        priority=TaskPriority.HIGH,
        completed_at=completed_at,
        position=3.5,
        markdown_note="note",
    )
    before = _get_task(migrated_session_factory, task_id)
    updated_at_before = before.updated_at

    archive_done_tasks(migrated_session_factory, NOW)

    after = _get_task(migrated_session_factory, task_id)
    assert after.archived_at == NOW
    assert after.status == TaskStatus.DONE
    assert after.completed_at == completed_at
    assert after.position == 3.5
    assert after.title == "Keep me"
    assert after.content == "Body"
    assert after.markdown_note == "note"
    assert after.updated_at == updated_at_before


def test_run_reports_zero_when_nothing_is_eligible(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    _seed_task(migrated_session_factory, status=TaskStatus.TODO)
    result = archive_done_tasks(migrated_session_factory, NOW)
    assert result.archived_count == 0


def test_second_run_does_not_re_stamp_an_already_archived_task(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(
        migrated_session_factory, status=TaskStatus.DONE, completed_at=NOW - SEVEN_DAYS
    )
    first = archive_done_tasks(migrated_session_factory, NOW)
    assert first.archived_count == 1
    stamped_at = _get_task(migrated_session_factory, task_id).archived_at

    later = NOW + timedelta(hours=1)
    second = archive_done_tasks(migrated_session_factory, later)
    assert second.archived_count == 0
    assert _get_task(migrated_session_factory, task_id).archived_at == stamped_at


# --- Clock -----------------------------------------------------------------


def test_naive_now_raises_value_error(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    naive = datetime(2026, 3, 8, 12, 0, 0)  # noqa: DTZ001 - deliberately naive
    with pytest.raises(ValueError, match="naive"):
        archive_done_tasks(migrated_session_factory, naive)


# --- Logging -----------------------------------------------------------------


def test_a_successful_run_emits_exactly_one_info_record_with_now_count_and_duration(
    migrated_session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    _seed_task(
        migrated_session_factory, status=TaskStatus.DONE, completed_at=NOW - SEVEN_DAYS
    )
    caplog.set_level(logging.INFO, logger="planora_api.jobs.archive_done_tasks")

    archive_done_tasks(migrated_session_factory, NOW)

    completed_records = [
        r for r in caplog.records if r.message == "archive_job_completed"
    ]
    assert len(completed_records) == 1
    record = completed_records[0]
    assert record.levelname == "INFO"
    assert record.now == NOW.isoformat()
    assert record.archived_count == 1
    assert isinstance(record.duration_ms, float)


def test_no_log_record_contains_task_content_sentinels(
    migrated_session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    sentinels = {
        "title": "SENTINEL-title-value",
        "content": "SENTINEL-content-value",
        "markdown_note": "SENTINEL-note-value",
    }
    _seed_task(
        migrated_session_factory,
        status=TaskStatus.DONE,
        completed_at=NOW - SEVEN_DAYS,
        urls=[{"url": "https://example.com", "label": "SENTINEL-label-value"}],
        **sentinels,
    )
    caplog.set_level(logging.DEBUG, logger="planora_api.jobs.archive_done_tasks")

    archive_done_tasks(migrated_session_factory, NOW)

    all_sentinels = [*sentinels.values(), "SENTINEL-label-value"]
    for record in caplog.records:
        message = record.getMessage()
        for sentinel in all_sentinels:
            assert sentinel not in message
            for value in vars(record).values():
                assert sentinel not in str(value)


def test_no_log_record_contains_task_content_sentinels_on_a_failed_run(
    migrated_session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sentinels = {
        "title": "SENTINEL-fail-title-value",
        "content": "SENTINEL-fail-content-value",
        "markdown_note": "SENTINEL-fail-note-value",
    }
    _seed_task(
        migrated_session_factory,
        status=TaskStatus.DONE,
        completed_at=NOW - SEVEN_DAYS,
        urls=[{"url": "https://example.com", "label": "SENTINEL-fail-label-value"}],
        **sentinels,
    )

    def failing_archive_one(*args: Any, **kwargs: Any) -> bool:
        raise RuntimeError("simulated failure")

    monkeypatch.setattr(job_module, "_archive_one", failing_archive_one)
    caplog.set_level(logging.DEBUG, logger="planora_api.jobs.archive_done_tasks")

    with pytest.raises(RuntimeError):
        archive_done_tasks(migrated_session_factory, NOW)

    all_sentinels = [*sentinels.values(), "SENTINEL-fail-label-value"]
    for record in caplog.records:
        message = record.getMessage()
        for sentinel in all_sentinels:
            assert sentinel not in message
            for value in vars(record).values():
                assert sentinel not in str(value)


# --- End-to-end with the HTTP API (board and archive listing) --------------


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _login(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD}
    )
    assert response.status_code == 200


def test_after_a_run_an_archived_task_leaves_the_board_and_appears_in_the_archive(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(
        migrated_session_factory, status=TaskStatus.DONE, completed_at=NOW - SEVEN_DAYS
    )
    app = app_factory()

    async def before_scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.get("/api/v1/tasks")

    before = _run(before_scenario)
    assert any(str(task_id) == item["id"] for item in before.json())

    archive_done_tasks(migrated_session_factory, NOW)

    async def after_scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            board = await client.get("/api/v1/tasks")
            archived = await client.get("/api/v1/archive")
            return board, archived

    board, archived = _run(after_scenario)

    assert board.status_code == 200
    assert not any(str(task_id) == item["id"] for item in board.json())
    assert archived.status_code == 200
    archived_ids = {item["id"] for item in archived.json()["items"]}
    assert str(task_id) in archived_ids
