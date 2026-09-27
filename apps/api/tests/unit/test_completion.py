"""Unit tests for `planora_api.domain.completion.resolve_completed_at`
(spec §5, §6.1, §9.1).

Pure function — no fixtures, no clock, no database.
"""

from __future__ import annotations

from datetime import UTC, datetime

from planora_api.db.models import TaskStatus
from planora_api.domain.completion import resolve_completed_at

NOW = datetime(2026, 9, 27, 12, 0, 0, tzinfo=UTC)
EARLIER = datetime(2026, 9, 1, 8, 0, 0, tzinfo=UTC)


# --- Creation (previous_status=None) -----------------------------------------


def test_new_task_created_done_gets_completed_at_now() -> None:
    result = resolve_completed_at(
        new_status="done", previous_status=None, previous_completed_at=None, now=NOW
    )
    assert result == NOW


def test_new_task_created_todo_has_no_completed_at() -> None:
    result = resolve_completed_at(
        new_status="todo", previous_status=None, previous_completed_at=None, now=NOW
    )
    assert result is None


def test_new_task_created_in_progress_has_no_completed_at() -> None:
    result = resolve_completed_at(
        new_status="in_progress",
        previous_status=None,
        previous_completed_at=None,
        now=NOW,
    )
    assert result is None


# --- Status change on an existing task ---------------------------------------


def test_entering_done_sets_completed_at_to_now() -> None:
    result = resolve_completed_at(
        new_status="done", previous_status="todo", previous_completed_at=None, now=NOW
    )
    assert result == NOW


def test_entering_done_from_in_progress_sets_completed_at_to_now() -> None:
    result = resolve_completed_at(
        new_status="done",
        previous_status="in_progress",
        previous_completed_at=None,
        now=NOW,
    )
    assert result == NOW


def test_staying_in_done_keeps_the_existing_completed_at() -> None:
    result = resolve_completed_at(
        new_status="done",
        previous_status="done",
        previous_completed_at=EARLIER,
        now=NOW,
    )
    assert result == EARLIER


def test_leaving_done_clears_completed_at() -> None:
    result = resolve_completed_at(
        new_status="in_progress",
        previous_status="done",
        previous_completed_at=EARLIER,
        now=NOW,
    )
    assert result is None


def test_leaving_done_to_todo_clears_completed_at() -> None:
    result = resolve_completed_at(
        new_status="todo",
        previous_status="done",
        previous_completed_at=EARLIER,
        now=NOW,
    )
    assert result is None


def test_staying_out_of_done_stays_none() -> None:
    result = resolve_completed_at(
        new_status="in_progress",
        previous_status="todo",
        previous_completed_at=None,
        now=NOW,
    )
    assert result is None


# --- Accepts real TaskStatus enum members, not just wire strings -------------


def test_accepts_taskstatus_enum_members_directly() -> None:
    result = resolve_completed_at(
        new_status=TaskStatus.DONE,
        previous_status=TaskStatus.TODO,
        previous_completed_at=None,
        now=NOW,
    )
    assert result == NOW


def test_accepts_taskstatus_enum_members_for_staying_done() -> None:
    result = resolve_completed_at(
        new_status=TaskStatus.DONE,
        previous_status=TaskStatus.DONE,
        previous_completed_at=EARLIER,
        now=NOW,
    )
    assert result == EARLIER
