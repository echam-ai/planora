"""Unit tests for `domain.chat_filters` (issue #40, spec §7.3, §7.4).

Pure — no fixtures, no database. Boundaries pinned exactly as the issue's
acceptance criteria require: the 24-hour due-soon window, a Done task
matching no `deadline_states` value, and combinable filters.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from planora_api.domain.chat_filters import ActiveTaskFilters, active_task_matches

NOW = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)


def _matches(**overrides: object) -> bool:
    defaults: dict[str, object] = {
        "title": "Task title",
        "status": "todo",
        "category": "work",
        "priority": "medium",
        "deadline_at": None,
        "now": NOW,
        "filters": ActiveTaskFilters(),
    }
    defaults.update(overrides)
    return active_task_matches(**defaults)  # type: ignore[arg-type]


# --- No filters: everything matches -----------------------------------------


def test_empty_filters_match_everything() -> None:
    assert _matches(filters=ActiveTaskFilters()) is True


# --- title_contains: case-insensitive substring -----------------------------


def test_title_contains_matches_case_insensitively() -> None:
    filters = ActiveTaskFilters(title_contains="TITLE")
    assert _matches(title="A Task Title here", filters=filters) is True


def test_title_contains_excludes_non_matching_title() -> None:
    filters = ActiveTaskFilters(title_contains="zzz")
    assert _matches(title="Nothing relevant", filters=filters) is False


def test_percent_and_underscore_match_literally_not_as_wildcards() -> None:
    # `active_task_matches` does plain Python substring matching (not a
    # LIKE pattern), so `%`/`_` are never wildcards here regardless.
    filters = ActiveTaskFilters(title_contains="50%")
    assert _matches(title="Discount: 50% off", filters=filters) is True
    assert _matches(title="Discount: 5000 off", filters=filters) is False


# --- statuses / categories / priorities: OR within, AND across -------------


def test_statuses_or_within_dimension() -> None:
    filters = ActiveTaskFilters(statuses=("todo", "done"))
    assert _matches(status="todo", filters=filters) is True
    assert _matches(status="done", filters=filters) is True
    assert _matches(status="in_progress", filters=filters) is False


def test_categories_and_priorities_combine_with_and() -> None:
    filters = ActiveTaskFilters(categories=("work",), priorities=("high",))
    assert _matches(category="work", priority="high", filters=filters) is True
    assert _matches(category="work", priority="low", filters=filters) is False
    assert _matches(category="personal", priority="high", filters=filters) is False


def test_multiple_categories_combine_with_or() -> None:
    filters = ActiveTaskFilters(categories=("work", "personal"))
    assert _matches(category="work", filters=filters) is True
    assert _matches(category="personal", filters=filters) is True
    assert _matches(category="study", filters=filters) is False


# --- deadline_states: exact §7.3 boundaries ---------------------------------


def test_deadline_exactly_24_hours_ahead_is_due_soon() -> None:
    filters = ActiveTaskFilters(deadline_states=("due_soon",))
    deadline = NOW + timedelta(hours=24)
    assert _matches(deadline_at=deadline, status="todo", filters=filters) is True


def test_deadline_24_hours_and_1_second_ahead_is_scheduled_not_due_soon() -> None:
    due_soon_filter = ActiveTaskFilters(deadline_states=("due_soon",))
    scheduled_filter = ActiveTaskFilters(deadline_states=("scheduled",))
    deadline = NOW + timedelta(hours=24, seconds=1)
    assert _matches(deadline_at=deadline, status="todo", filters=due_soon_filter) is False
    assert _matches(deadline_at=deadline, status="todo", filters=scheduled_filter) is True


def test_deadline_1_second_in_the_past_is_overdue() -> None:
    filters = ActiveTaskFilters(deadline_states=("overdue",))
    deadline = NOW - timedelta(seconds=1)
    assert _matches(deadline_at=deadline, status="todo", filters=filters) is True


def test_no_deadline_matches_none_state() -> None:
    filters = ActiveTaskFilters(deadline_states=("none",))
    assert _matches(deadline_at=None, status="todo", filters=filters) is True


def test_done_task_with_past_deadline_matches_no_deadline_state() -> None:
    """A Done task's derived state is always `"completed"`, which is never
    a valid `deadline_states` argument value — so it matches nothing,
    including `overdue`, even with a deadline far in the past."""
    deadline = NOW - timedelta(days=30)
    for state in ("none", "scheduled", "due_soon", "overdue"):
        filters = ActiveTaskFilters(deadline_states=(state,))
        assert _matches(deadline_at=deadline, status="done", filters=filters) is False


def test_done_task_matches_when_deadline_states_is_not_filtered_at_all() -> None:
    # An empty deadline_states means that dimension does not filter, so a
    # Done task still matches on title/category/priority alone.
    filters = ActiveTaskFilters(categories=("work",))
    assert _matches(status="done", category="work", filters=filters) is True
