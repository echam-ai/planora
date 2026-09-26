"""Unit tests for `planora_api.domain.archive_policy.is_eligible_for_archive`
(spec §9.1).

Pure function, no fixtures, no database, no clock.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest

from planora_api.domain.archive_policy import is_eligible_for_archive

NOW = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
D7 = timedelta(days=7)
MS = timedelta(milliseconds=1)


# --- The seven-day boundary --------------------------------------------------


@pytest.mark.parametrize(
    ("completed_at", "expected"),
    [
        (NOW - D7 + MS, False),
        (NOW - D7, True),
        (NOW - D7 - MS, True),
    ],
)
def test_archive_eligibility_at_the_seven_day_boundary(
    completed_at: datetime, expected: bool
) -> None:
    assert is_eligible_for_archive("done", completed_at, NOW) is expected


# --- Offset independence -----------------------------------------------------


def test_result_depends_on_the_instant_not_the_offset() -> None:
    completed_at = NOW - D7
    plus_seven = completed_at.astimezone(timezone(timedelta(hours=7)))
    assert is_eligible_for_archive("done", completed_at, NOW) is True
    assert is_eligible_for_archive("done", plus_seven, NOW) is True


# --- Timer cancelled or never started ----------------------------------------


@pytest.mark.parametrize("status", ["todo", "in_progress"])
def test_non_done_status_is_never_eligible_even_with_an_old_completed_at(
    status: str,
) -> None:
    old = NOW - timedelta(days=30)
    assert is_eligible_for_archive(status, old, NOW) is False


def test_done_with_no_completed_at_is_not_eligible_and_raises_nothing() -> None:
    assert is_eligible_for_archive("done", None, NOW) is False


# --- Naive datetimes are rejected -------------------------------------------


def test_naive_now_raises() -> None:
    naive = datetime(2026, 3, 1, 12, 0)  # noqa: DTZ001 - deliberately naive
    with pytest.raises(ValueError, match="naive"):
        is_eligible_for_archive("done", NOW - D7, naive)


def test_naive_completed_at_raises() -> None:
    naive = datetime(2026, 3, 1, 12, 0)  # noqa: DTZ001 - deliberately naive
    with pytest.raises(ValueError, match="naive"):
        is_eligible_for_archive("done", naive, NOW)


def test_naive_completed_at_raises_even_when_status_is_not_done() -> None:
    naive = datetime(2026, 3, 1, 12, 0)  # noqa: DTZ001 - deliberately naive
    with pytest.raises(ValueError, match="naive"):
        is_eligible_for_archive("todo", naive, NOW)


# --- Purity: same inputs, same output ---------------------------------------


def test_is_deterministic_for_the_same_arguments() -> None:
    first = is_eligible_for_archive("done", NOW - D7, NOW)
    second = is_eligible_for_archive("done", NOW - D7, NOW)
    assert first == second


# --- TaskStatus enum members work as well as plain strings ------------------


def test_accepts_a_taskstatus_enum_member_as_well_as_its_wire_string() -> None:
    from planora_api.db.models import TaskStatus

    assert is_eligible_for_archive(TaskStatus.DONE, NOW - D7, NOW) is True
    assert is_eligible_for_archive(TaskStatus.TODO, NOW - D7, NOW) is False
