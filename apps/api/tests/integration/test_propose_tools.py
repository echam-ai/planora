"""Integration tests for `ai.propose_tools` (issue #41, spec §10.1-§10.4).

Exercises the four `propose_*` executors directly against a migrated
SQLite database (`migrated_session_factory`) — no LLM, no HTTP client, no
app. A `before_cursor_execute` listener asserts each executor issues only
`SELECT` statements (nothing is persisted until a later confirm — see
`ai.chat`'s module docstring), and a task-row snapshot asserts nothing is
mutated.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.ai.propose_tools import (
    ProposeCreateTaskArgs,
    ProposeMoveTaskArgs,
    ProposeSetDeadlineArgs,
    ProposeUpdateTaskArgs,
    propose_create_task,
    propose_move_task,
    propose_set_deadline,
    propose_update_task,
)
from planora_api.db.models import Task, TaskCategory, TaskPriority, TaskStatus

NOW = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)
TZ = "Asia/Singapore"  # UTC+8, no DST


def _seed_task(session_factory: sessionmaker[Session], **overrides: Any) -> uuid.UUID:
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


def _snapshot(session_factory: sessionmaker[Session]) -> dict[uuid.UUID, dict[str, Any]]:
    with session_factory() as session:
        tasks = list(session.execute(select(Task)).scalars().all())
        return {
            task.id: {
                "title": task.title,
                "status": task.status,
                "category": task.category,
                "priority": task.priority,
                "deadline_at": task.deadline_at,
                "updated_at": task.updated_at,
            }
            for task in tasks
        }


_NON_SELECT_PREFIXES = ("insert", "update", "delete")


@contextmanager
def _assert_only_selects(session_factory: sessionmaker[Session]) -> Iterator[None]:
    engine = session_factory.kw["bind"]
    issued: list[str] = []

    def _listener(conn: object, cursor: object, statement: str, *_args: object) -> None:
        issued.append(statement)

    event.listen(engine, "before_cursor_execute", _listener)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", _listener)
        non_selects = [s for s in issued if s.strip().lower().startswith(_NON_SELECT_PREFIXES)]
        assert not non_selects, f"a propose tool issued non-SELECT statement(s): {non_selects}"


# --- propose_create_task -------------------------------------------------------


def test_propose_create_task_returns_pending_confirmation_and_a_proposal(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    args = ProposeCreateTaskArgs(
        title="Book dentist",
        content="Call ahead",
        category=TaskCategory.PERSONAL,
        priority=TaskPriority.HIGH,
        deadline="2026-10-09T17:00",
    )
    with migrated_session_factory() as session, _assert_only_selects(migrated_session_factory):
        result = propose_create_task(session, args, NOW, TZ)

    assert result.tool_result == {"status": "pending_confirmation"}
    assert result.proposal is not None
    assert result.proposal.kind == "create"
    assert result.proposal.task_id is None
    assert result.proposal.stale_snapshot == {}
    draft = result.proposal.payload["draft"]
    assert draft["title"] == "Book dentist"
    assert draft["deadline_at"] == "2026-10-09T09:00:00+00:00"
    assert [f.label for f in result.proposal.fields] == [
        "Title", "Content", "Category", "Priority", "Deadline",
    ]


def test_propose_create_task_never_writes(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    before = _snapshot(migrated_session_factory)
    args = ProposeCreateTaskArgs(
        title="X", content="Y", category=TaskCategory.WORK, priority=TaskPriority.LOW
    )
    with migrated_session_factory() as session, _assert_only_selects(migrated_session_factory):
        propose_create_task(session, args, NOW, TZ)
    assert _snapshot(migrated_session_factory) == before


def test_propose_create_task_rejects_impossible_date() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        ProposeCreateTaskArgs(
            title="X", content="Y", category=TaskCategory.WORK, priority=TaskPriority.LOW,
            deadline="2026-02-30",
        )


def test_propose_create_task_rejects_blank_title() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        ProposeCreateTaskArgs(
            title="   ", content="Y", category=TaskCategory.WORK, priority=TaskPriority.LOW
        )


def test_propose_create_task_rejects_non_http_url() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        ProposeCreateTaskArgs.model_validate(
            {
                "title": "X", "content": "Y", "category": "work", "priority": "low",
                "urls": [{"url": "javascript:alert(1)"}],
            }
        )


# --- propose_update_task --------------------------------------------------------


def test_propose_update_task_diffs_only_changed_fields(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(migrated_session_factory, title="Old", priority=TaskPriority.LOW)
    args = ProposeUpdateTaskArgs(task_id=task_id, priority=TaskPriority.HIGH, title="Old")

    with migrated_session_factory() as session, _assert_only_selects(migrated_session_factory):
        result = propose_update_task(session, args, NOW, TZ)

    assert result.tool_result == {"status": "pending_confirmation"}
    assert result.proposal is not None
    assert [f.label for f in result.proposal.fields] == ["Priority"]
    assert result.proposal.changed_fields == {"priority": "high"}
    assert result.proposal.stale_snapshot == {"priority": "low"}
    assert result.proposal.payload["task_id"] == str(task_id)
    assert result.proposal.payload["draft"]["title"] == "Old"
    assert result.proposal.payload["draft"]["priority"] == "high"


def test_propose_update_task_no_change_is_error_result(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(migrated_session_factory, title="Same")
    args = ProposeUpdateTaskArgs(task_id=task_id, title="Same")

    with migrated_session_factory() as session:
        result = propose_update_task(session, args, NOW, TZ)

    assert result.tool_result == {"error": "invalid_tool_call"}
    assert result.proposal is None


def test_propose_update_task_no_fields_provided_is_error_result(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(migrated_session_factory)
    with migrated_session_factory() as session:
        result = propose_update_task(session, ProposeUpdateTaskArgs(task_id=task_id), NOW, TZ)
    assert result.tool_result == {"error": "invalid_tool_call"}


def test_propose_update_task_unknown_task_id_is_error_result(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    with migrated_session_factory() as session:
        result = propose_update_task(
            session, ProposeUpdateTaskArgs(task_id=uuid.uuid4(), title="X"), NOW, TZ
        )
    assert result.tool_result == {"error": "invalid_tool_call"}
    assert result.proposal is None


def test_propose_update_task_archived_task_id_is_error_result(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(
        migrated_session_factory,
        status=TaskStatus.DONE,
        completed_at=NOW - timedelta(days=10),
        archived_at=NOW - timedelta(days=1),
    )
    with migrated_session_factory() as session:
        result = propose_update_task(
            session, ProposeUpdateTaskArgs(task_id=task_id, title="X"), NOW, TZ
        )
    assert result.tool_result == {"error": "invalid_tool_call"}


def test_propose_update_task_blank_title_is_error_result() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        ProposeUpdateTaskArgs(task_id=uuid.uuid4(), title="   ")


# --- propose_move_task -----------------------------------------------------------


def test_propose_move_task_returns_status_field(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(migrated_session_factory, status=TaskStatus.TODO)
    args = ProposeMoveTaskArgs(task_id=task_id, status=TaskStatus.DONE)

    with migrated_session_factory() as session, _assert_only_selects(migrated_session_factory):
        result = propose_move_task(session, args, NOW, TZ)

    assert result.proposal is not None
    assert result.proposal.kind == "move"
    field = result.proposal.fields[0]
    assert field.label == "Status"
    assert field.from_value == "Todo"
    assert field.to_value == "Done"
    assert result.proposal.stale_snapshot == {"status": "todo"}
    assert result.proposal.payload == {"task_id": str(task_id), "status": "done"}


def test_propose_move_task_same_status_is_error_result(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(migrated_session_factory, status=TaskStatus.TODO)
    with migrated_session_factory() as session:
        result = propose_move_task(
            session, ProposeMoveTaskArgs(task_id=task_id, status=TaskStatus.TODO), NOW, TZ
        )
    assert result.tool_result == {"error": "invalid_tool_call"}
    assert result.proposal is None


def test_propose_move_task_archived_task_is_error_result(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(
        migrated_session_factory,
        status=TaskStatus.DONE,
        completed_at=NOW - timedelta(days=10),
        archived_at=NOW - timedelta(days=1),
    )
    with migrated_session_factory() as session:
        result = propose_move_task(
            session, ProposeMoveTaskArgs(task_id=task_id, status=TaskStatus.TODO), NOW, TZ
        )
    assert result.tool_result == {"error": "invalid_tool_call"}


# --- propose_set_deadline --------------------------------------------------------


def test_propose_set_deadline_sets_a_new_deadline(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(migrated_session_factory, deadline_at=None)
    args = ProposeSetDeadlineArgs(task_id=task_id, deadline="2026-10-09T17:00")

    with migrated_session_factory() as session, _assert_only_selects(migrated_session_factory):
        result = propose_set_deadline(session, args, NOW, TZ)

    assert result.proposal is not None
    assert result.proposal.kind == "schedule"
    field = result.proposal.fields[0]
    assert field.from_value == "No deadline"
    assert field.to_value == "09 Oct 2026, 17:00"
    assert result.proposal.payload == {
        "task_id": str(task_id), "deadline_at": "2026-10-09T09:00:00+00:00",
    }
    assert result.proposal.stale_snapshot == {"deadline_at": None}


def test_propose_set_deadline_null_removes_it(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    existing = NOW + timedelta(days=1)
    task_id = _seed_task(migrated_session_factory, deadline_at=existing)
    args = ProposeSetDeadlineArgs(task_id=task_id, deadline=None)

    with migrated_session_factory() as session:
        result = propose_set_deadline(session, args, NOW, TZ)

    assert result.proposal is not None
    assert result.proposal.payload["deadline_at"] is None
    assert result.proposal.fields[0].to_value == "No deadline"


def test_propose_set_deadline_same_value_is_error_result(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    task_id = _seed_task(migrated_session_factory, deadline_at=None)
    with migrated_session_factory() as session:
        result = propose_set_deadline(
            session, ProposeSetDeadlineArgs(task_id=task_id, deadline=None), NOW, TZ
        )
    assert result.tool_result == {"error": "invalid_tool_call"}
    assert result.proposal is None


def test_propose_set_deadline_impossible_date_rejected() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        ProposeSetDeadlineArgs(task_id=uuid.uuid4(), deadline="2026-02-30")


def test_propose_set_deadline_unknown_task_is_error_result(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    with migrated_session_factory() as session:
        result = propose_set_deadline(
            session, ProposeSetDeadlineArgs(task_id=uuid.uuid4(), deadline=None), NOW, TZ
        )
    assert result.tool_result == {"error": "invalid_tool_call"}


# --- Argument schema validation --------------------------------------------------


def test_propose_update_task_args_rejects_extra_key() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        ProposeUpdateTaskArgs.model_validate({"task_id": str(uuid.uuid4()), "status": "done"})


def test_propose_move_task_args_rejects_invalid_status_enum() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        ProposeMoveTaskArgs.model_validate({"task_id": str(uuid.uuid4()), "status": "urgent"})


def test_propose_create_task_args_rejects_missing_required_field() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        ProposeCreateTaskArgs.model_validate({"title": "X"})
