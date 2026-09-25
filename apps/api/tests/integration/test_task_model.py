"""Integration tests for the task table (spec §5, issue #22).

Every test here uses `migrated_session_factory` (see `conftest.py`), which
applies the Alembic migration to a disposable SQLite file under the repo's
`.tmp/` — never `metadata.create_all` — so these tests exercise exactly what
`uv run alembic upgrade head` produces.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.exc import StatementError
from sqlalchemy.orm import Session, sessionmaker

from planora_api.db.models import Task, TaskCategory, TaskPriority, TaskStatus


def _make_task(**overrides: Any) -> Task:
    defaults: dict[str, Any] = {
        "title": "Ship the quarterly report",
        "content": "Draft, review and send the quarterly report.",
        "status": TaskStatus.TODO,
        "category": TaskCategory.WORK,
        "priority": TaskPriority.HIGH,
        "position": 1.0,
    }
    defaults.update(overrides)
    return Task(**defaults)


def test_round_trips_every_field_with_a_non_utc_deadline(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    deadline = datetime(2026, 10, 1, 9, 0, 0, tzinfo=timezone(timedelta(hours=8)))
    completed = datetime(2026, 9, 20, 12, 0, 0, tzinfo=UTC)
    urls = [
        {"url": "https://example.com/a", "label": "Reference"},
        {"url": "https://example.com/b", "label": None},
    ]

    with migrated_session_factory() as session:
        task = _make_task(
            deadline_at=deadline,
            completed_at=completed,
            markdown_note="# Notes",
            urls=urls,
        )
        session.add(task)
        session.commit()
        task_id = task.id
        assert task.id is not None
        assert task.created_at is not None
        assert task.updated_at is not None

    # A new session — the read-back is independent of the one that wrote it.
    with migrated_session_factory() as session:
        reloaded = session.get(Task, task_id)
        assert reloaded is not None
        assert reloaded.title == "Ship the quarterly report"
        assert reloaded.content == "Draft, review and send the quarterly report."
        assert reloaded.status == TaskStatus.TODO
        assert reloaded.category == TaskCategory.WORK
        assert reloaded.priority == TaskPriority.HIGH
        assert reloaded.position == 1.0
        assert reloaded.markdown_note == "# Notes"
        assert reloaded.urls == urls

        # The +08:00 input reads back as the equivalent UTC instant, and
        # timezone-aware even though SQLite has no native tz type.
        assert reloaded.deadline_at == datetime(2026, 10, 1, 1, 0, 0, tzinfo=UTC)
        assert reloaded.deadline_at.tzinfo is not None
        assert reloaded.completed_at == completed
        assert reloaded.completed_at.tzinfo is not None
        assert reloaded.archived_at is None
        assert reloaded.created_at.tzinfo is not None
        assert reloaded.updated_at.tzinfo is not None


def test_defaults_for_a_minimal_task(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    with migrated_session_factory() as session:
        task = _make_task()
        session.add(task)
        session.commit()
        task_id = task.id

    with migrated_session_factory() as session:
        reloaded = session.get(Task, task_id)
        assert reloaded is not None
        assert reloaded.markdown_note == ""
        assert reloaded.urls == []
        assert reloaded.deadline_at is None
        assert reloaded.completed_at is None
        assert reloaded.archived_at is None


def test_updated_at_advances_when_a_row_is_modified(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    with migrated_session_factory() as session:
        task = _make_task()
        session.add(task)
        session.commit()
        task_id = task.id
        first_updated_at = task.updated_at

    with migrated_session_factory() as session:
        task = session.get(Task, task_id)
        assert task is not None
        task.title = "Ship the quarterly report (revised)"
        session.commit()
        assert task.updated_at > first_updated_at


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("status", "archived"),
        ("category", "urgent"),
        ("priority", "critical"),
    ],
)
def test_invalid_enum_value_is_rejected(
    migrated_session_factory: sessionmaker[Session],
    field: str,
    value: str,
) -> None:
    with migrated_session_factory() as session:
        task = _make_task(**{field: value})
        session.add(task)
        with pytest.raises(StatementError):
            session.commit()
        session.rollback()

    with migrated_session_factory() as session:
        remaining = session.execute(select(Task)).scalars().all()
        assert remaining == []
