"""Unit tests for `planora_api.domain.deadline.deadline_state` (spec §7.3).

Pure function, no fixtures, no database, no clock — every case fixes its own
`now` and passes it in explicitly.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest

from planora_api.domain.deadline import deadline_state

NOW = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
H24 = timedelta(hours=24)
MS = timedelta(milliseconds=1)


# --- Non-Done: the 24-hour boundary ----------------------------------------


@pytest.mark.parametrize(
    ("deadline_at", "expected"),
    [
        (NOW + H24 + MS, "scheduled"),
        (NOW + H24, "due_soon"),
        (NOW + H24 - MS, "due_soon"),
        (NOW, "due_soon"),
        (NOW - MS, "overdue"),
    ],
)
@pytest.mark.parametrize("status", ["todo", "in_progress"])
def test_deadline_state_at_the_24_hour_boundary(
    status: str, deadline_at: datetime, expected: str
) -> None:
    assert deadline_state(deadline_at, status, NOW) == expected


def test_non_done_task_with_no_deadline_is_none() -> None:
    assert deadline_state(None, "todo", NOW) == "none"
    assert deadline_state(None, "in_progress", NOW) == "none"


# --- Done overrides everything -----------------------------------------------


@pytest.mark.parametrize(
    "deadline_at",
    [None, NOW + timedelta(days=30), NOW + H24, NOW, NOW - timedelta(days=30)],
)
def test_done_status_is_always_completed(deadline_at: datetime | None) -> None:
    assert deadline_state(deadline_at, "done", NOW) == "completed"


@pytest.mark.parametrize("deadline_at", [NOW - MS, NOW - timedelta(days=30)])
def test_done_with_a_past_deadline_is_completed_never_overdue(
    deadline_at: datetime,
) -> None:
    assert deadline_state(deadline_at, "done", NOW) == "completed"


# --- Offset independence -----------------------------------------------------


@pytest.mark.parametrize(
    ("deadline_at", "expected"),
    [
        (NOW + H24 + MS, "scheduled"),
        (NOW + H24, "due_soon"),
        (NOW + H24 - MS, "due_soon"),
        (NOW, "due_soon"),
        (NOW - MS, "overdue"),
    ],
)
def test_result_depends_on_the_instant_not_the_offset(
    deadline_at: datetime, expected: str
) -> None:
    plus_seven = deadline_at.astimezone(timezone(timedelta(hours=7)))
    assert deadline_state(deadline_at, "todo", NOW) == expected
    assert deadline_state(plus_seven, "todo", NOW) == expected


# --- Naive datetimes are rejected -------------------------------------------


def test_naive_now_raises() -> None:
    naive = datetime(2026, 3, 1, 12, 0)  # noqa: DTZ001 - deliberately naive
    with pytest.raises(ValueError, match="naive"):
        deadline_state(NOW + H24, "todo", naive)


def test_naive_deadline_raises() -> None:
    naive = datetime(2026, 3, 1, 12, 0)  # noqa: DTZ001 - deliberately naive
    with pytest.raises(ValueError, match="naive"):
        deadline_state(naive, "todo", NOW)


def test_naive_deadline_raises_even_for_a_done_task() -> None:
    """A naive input is invalid regardless of what branch of the business
    logic would otherwise use it."""
    naive = datetime(2026, 3, 1, 12, 0)  # noqa: DTZ001 - deliberately naive
    with pytest.raises(ValueError, match="naive"):
        deadline_state(naive, "done", NOW)


# --- Purity: same inputs, same output ---------------------------------------


def test_is_deterministic_for_the_same_arguments() -> None:
    first = deadline_state(NOW + H24, "todo", NOW)
    second = deadline_state(NOW + H24, "todo", NOW)
    assert first == second


# --- TaskStatus enum members work as well as plain strings ------------------


def test_accepts_a_taskstatus_enum_member_as_well_as_its_wire_string() -> None:
    from planora_api.db.models import TaskStatus

    assert deadline_state(None, TaskStatus.DONE, NOW) == "completed"
    assert deadline_state(None, TaskStatus.TODO, NOW) == "none"
    assert deadline_state(NOW - MS, TaskStatus.IN_PROGRESS, NOW) == "overdue"
