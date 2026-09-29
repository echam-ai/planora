"""Integration tests for `ai.chat_tools` (issue #40, spec §7.3, §7.4, §9.2,
§10.1, §10.4).

Exercises `find_active_tasks`/`search_archive` directly against a migrated
SQLite database (`migrated_session_factory`) — no LLM, no HTTP client, no
app. A `before_cursor_execute` listener asserts each executor issues only
`SELECT` statements, and a task-row snapshot asserts nothing is mutated,
`updated_at` included.
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

from planora_api.ai.chat_tools import (
    FindActiveTasksArgs,
    SearchArchiveArgs,
    find_active_tasks,
    search_archive,
)
from planora_api.db.models import Task, TaskCategory, TaskPriority, TaskStatus

NOW = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)
TZ = "Asia/Singapore"  # UTC+8, no DST — deterministic offset for assertions


def _seed_task(session_factory: sessionmaker[Session], **overrides: Any) -> uuid.UUID:
    defaults: dict[str, Any] = {
        "title": "Task",
        "content": "SENTINEL-content-must-never-leak",
        "markdown_note": "SENTINEL-note-must-never-leak",
        "urls": [{"url": "https://example.com/SENTINEL", "label": None}],
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
                "content": task.content,
                "status": task.status,
                "category": task.category,
                "priority": task.priority,
                "deadline_at": task.deadline_at,
                "urls": task.urls,
                "markdown_note": task.markdown_note,
                "position": task.position,
                "created_at": task.created_at,
                "updated_at": task.updated_at,
                "completed_at": task.completed_at,
                "archived_at": task.archived_at,
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
        assert not non_selects, f"a read tool issued non-SELECT statement(s): {non_selects}"


# --- find_active_tasks: filters (spec §7.4) ---------------------------------


def test_no_filters_returns_every_active_task_in_board_order(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    _seed_task(migrated_session_factory, title="Todo", status=TaskStatus.TODO, position=2.0)
    _seed_task(
        migrated_session_factory, title="InProgress", status=TaskStatus.IN_PROGRESS, position=1.0
    )
    _seed_task(migrated_session_factory, title="Done", status=TaskStatus.DONE, position=1.0)

    with migrated_session_factory() as session, _assert_only_selects(migrated_session_factory):
        result = find_active_tasks(
            session, FindActiveTasksArgs(), now=NOW, timezone_name=TZ
        )

    assert [t["title"] for t in result["tasks"]] == ["Todo", "InProgress", "Done"]
    assert result["total"] == 3
    assert result["truncated"] is False


def test_title_contains_is_case_insensitive_substring_on_title_only(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    _seed_task(migrated_session_factory, title="Renew the passport")
    _seed_task(migrated_session_factory, title="Buy groceries")

    with migrated_session_factory() as session:
        result = find_active_tasks(
            session,
            FindActiveTasksArgs(title_contains="PASSPORT"),
            now=NOW,
            timezone_name=TZ,
        )

    assert [t["title"] for t in result["tasks"]] == ["Renew the passport"]


def test_statuses_categories_priorities_combine_and_within_or_across(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    _seed_task(
        migrated_session_factory,
        title="WorkHigh",
        category=TaskCategory.WORK,
        priority=TaskPriority.HIGH,
    )
    _seed_task(
        migrated_session_factory,
        title="WorkLow",
        category=TaskCategory.WORK,
        priority=TaskPriority.LOW,
    )
    _seed_task(
        migrated_session_factory,
        title="PersonalHigh",
        category=TaskCategory.PERSONAL,
        priority=TaskPriority.HIGH,
    )

    with migrated_session_factory() as session:
        result = find_active_tasks(
            session,
            FindActiveTasksArgs(categories=[TaskCategory.WORK], priorities=[TaskPriority.HIGH]),
            now=NOW,
            timezone_name=TZ,
        )
    assert [t["title"] for t in result["tasks"]] == ["WorkHigh"]

    with migrated_session_factory() as session:
        result = find_active_tasks(
            session,
            FindActiveTasksArgs(categories=[TaskCategory.WORK, TaskCategory.PERSONAL]),
            now=NOW,
            timezone_name=TZ,
        )
    assert {t["title"] for t in result["tasks"]} == {"WorkHigh", "WorkLow", "PersonalHigh"}


def test_due_soon_boundary_exactly_24_hours(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    _seed_task(migrated_session_factory, title="AtBoundary", deadline_at=NOW + timedelta(hours=24))
    _seed_task(
        migrated_session_factory,
        title="JustOver",
        deadline_at=NOW + timedelta(hours=24, seconds=1),
    )
    _seed_task(migrated_session_factory, title="JustPast", deadline_at=NOW - timedelta(seconds=1))

    with migrated_session_factory() as session:
        result = find_active_tasks(
            session, FindActiveTasksArgs(deadline_states=["due_soon"]), now=NOW, timezone_name=TZ
        )
    assert [t["title"] for t in result["tasks"]] == ["AtBoundary"]


def test_done_task_with_past_deadline_never_matches_overdue(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    _seed_task(
        migrated_session_factory,
        title="OverdueTodo",
        status=TaskStatus.TODO,
        deadline_at=NOW - timedelta(days=1),
    )
    _seed_task(
        migrated_session_factory,
        title="DoneWithPastDeadline",
        status=TaskStatus.DONE,
        deadline_at=NOW - timedelta(days=1),
        completed_at=NOW - timedelta(hours=1),
    )

    with migrated_session_factory() as session:
        result = find_active_tasks(
            session, FindActiveTasksArgs(deadline_states=["overdue"]), now=NOW, timezone_name=TZ
        )
    assert [t["title"] for t in result["tasks"]] == ["OverdueTodo"]


# --- Minimum data and truncation (spec §10.4) -------------------------------


def test_active_result_has_exactly_the_minimum_keys_and_no_sensitive_content(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    sentinel_content = "SENTINEL-active-content"
    sentinel_note = "SENTINEL-active-note"
    sentinel_url = "https://example.com/SENTINEL-active-url"
    _seed_task(
        migrated_session_factory,
        title="Task with secrets",
        content=sentinel_content,
        markdown_note=sentinel_note,
        urls=[{"url": sentinel_url, "label": None}],
        deadline_at=NOW + timedelta(hours=1),
    )

    with migrated_session_factory() as session:
        result = find_active_tasks(session, FindActiveTasksArgs(), now=NOW, timezone_name=TZ)

    assert result["total"] == 1
    task = result["tasks"][0]
    assert set(task.keys()) == {
        "id", "title", "status", "category", "priority", "deadline_at", "deadline_state",
    }
    assert uuid.UUID(task["id"])
    assert task["deadline_state"] == "due_soon"
    dumped = str(result)
    assert sentinel_content not in dumped
    assert sentinel_note not in dumped
    assert sentinel_url not in dumped


def test_deadline_at_is_rendered_in_the_effective_timezone(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    _seed_task(migrated_session_factory, title="Zoned", deadline_at=NOW + timedelta(hours=1))

    with migrated_session_factory() as session:
        result = find_active_tasks(session, FindActiveTasksArgs(), now=NOW, timezone_name=TZ)

    deadline_at = result["tasks"][0]["deadline_at"]
    assert deadline_at is not None
    parsed = datetime.fromisoformat(deadline_at)
    assert parsed.utcoffset() == timedelta(hours=8)
    assert parsed.astimezone(UTC) == NOW + timedelta(hours=1)


def test_more_than_50_matches_is_truncated_but_total_counts_every_match(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    for index in range(55):
        _seed_task(migrated_session_factory, title=f"Task {index}", position=float(index))

    with migrated_session_factory() as session:
        result = find_active_tasks(session, FindActiveTasksArgs(), now=NOW, timezone_name=TZ)

    assert result["total"] == 55
    assert len(result["tasks"]) == 50
    assert result["truncated"] is True


# --- search_archive (spec §9.2) ---------------------------------------------


def test_search_archive_matches_title_only_case_insensitively_newest_first(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    _seed_task(
        migrated_session_factory,
        title="Renew passport",
        status=TaskStatus.DONE,
        completed_at=NOW - timedelta(days=10),
        archived_at=NOW - timedelta(days=3),
    )
    _seed_task(
        migrated_session_factory,
        title="Pay rent",
        status=TaskStatus.DONE,
        completed_at=NOW - timedelta(days=5),
        archived_at=NOW - timedelta(days=1),
    )
    # Active task with a matching title never appears in archive results.
    _seed_task(migrated_session_factory, title="Passport photos")

    with migrated_session_factory() as session, _assert_only_selects(migrated_session_factory):
        result = search_archive(
            session, SearchArchiveArgs(title_contains="PASSPORT"), now=NOW, timezone_name=TZ
        )

    assert [t["title"] for t in result["tasks"]] == ["Renew passport"]
    assert result["total"] == 1


def test_search_archive_result_has_exactly_the_archive_minimum_keys(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    sentinel_content = "SENTINEL-archive-content"
    _seed_task(
        migrated_session_factory,
        title="Archived sentinel task",
        content=sentinel_content,
        status=TaskStatus.DONE,
        completed_at=NOW - timedelta(days=10),
        archived_at=NOW - timedelta(days=3),
    )

    with migrated_session_factory() as session:
        result = search_archive(
            session, SearchArchiveArgs(title_contains="sentinel"), now=NOW, timezone_name=TZ
        )

    task = result["tasks"][0]
    assert set(task.keys()) == {"id", "title", "category", "priority", "completed_at", "archived_at"}
    assert sentinel_content not in str(result)


def test_search_archive_never_writes_and_never_mutates_task_rows(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    _seed_task(
        migrated_session_factory,
        title="Renew passport",
        status=TaskStatus.DONE,
        completed_at=NOW - timedelta(days=10),
        archived_at=NOW - timedelta(days=3),
    )
    before = _snapshot(migrated_session_factory)

    with migrated_session_factory() as session, _assert_only_selects(migrated_session_factory):
        search_archive(
            session, SearchArchiveArgs(title_contains="passport"), now=NOW, timezone_name=TZ
        )

    assert _snapshot(migrated_session_factory) == before


def test_find_active_tasks_never_writes_and_never_mutates_task_rows(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    _seed_task(migrated_session_factory, title="Task", deadline_at=NOW + timedelta(hours=1))
    before = _snapshot(migrated_session_factory)

    with migrated_session_factory() as session, _assert_only_selects(migrated_session_factory):
        find_active_tasks(session, FindActiveTasksArgs(), now=NOW, timezone_name=TZ)

    assert _snapshot(migrated_session_factory) == before


# --- Argument schema validation ---------------------------------------------


def test_find_active_tasks_args_rejects_unknown_field() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        FindActiveTasksArgs.model_validate({"priorities": ["urgent"]})


def test_find_active_tasks_args_rejects_extra_key() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        FindActiveTasksArgs.model_validate({"status": "todo"})  # wrong key name


def test_search_archive_args_requires_title_contains() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        SearchArchiveArgs.model_validate({})


def test_search_archive_args_rejects_over_200_chars() -> None:
    with pytest.raises(Exception):  # noqa: B017 - pydantic ValidationError
        SearchArchiveArgs.model_validate({"title_contains": "x" * 201})
