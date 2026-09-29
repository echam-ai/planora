"""Pure filter matching for the assistant's `find_active_tasks` read tool
(issue #40, spec §7.4, §10.1).

`domain/` modules do no I/O (binding rule 5): this module takes plain field
values — never a `Task` ORM instance and never a `planora_api.db` import
(enforced by `tests/unit/test_domain_purity.py`) — and reuses
`domain.deadline.deadline_state` for the 24-hour rule rather than keeping a
second copy of it. The caller (`ai.chat_tools`) supplies both the task's
fields and the reference instant; this module never reads the clock.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime

from planora_api.domain.deadline import deadline_state


@dataclass(frozen=True)
class ActiveTaskFilters:
    """One `find_active_tasks` call's arguments, already validated and
    normalized by `ai.chat_tools` — every sequence holds plain wire strings
    (e.g. `"work"`, `"due_soon"`), and an empty sequence or `None`
    `title_contains` means that dimension does not filter (spec §7.4:
    "Selecting nothing within a dimension means that dimension does not
    filter")."""

    title_contains: str | None = None
    statuses: Sequence[str] = field(default_factory=tuple)
    categories: Sequence[str] = field(default_factory=tuple)
    priorities: Sequence[str] = field(default_factory=tuple)
    deadline_states: Sequence[str] = field(default_factory=tuple)


def active_task_matches(
    *,
    title: str,
    status: str,
    category: str,
    priority: str,
    deadline_at: datetime | None,
    now: datetime,
    filters: ActiveTaskFilters,
) -> bool:
    """Whether one active task matches `filters` at instant `now`.

    Filters combine exactly as spec §7.4 describes: an empty dimension
    never excludes anything, values *within* one dimension combine with
    OR (a case-insensitive substring test is the one-value case for
    `title_contains`), and different dimensions combine with AND.

    `deadline_states` never includes `"completed"` — the caller's schema
    forbids it as an argument value — so a Done task (whose derived state
    is always `"completed"`) matches no `deadline_states` filter, exactly
    as spec §7.4 requires for the equivalent board filter.
    """
    if filters.title_contains and filters.title_contains.lower() not in title.lower():
        return False
    if filters.statuses and status not in filters.statuses:
        return False
    if filters.categories and category not in filters.categories:
        return False
    if filters.priorities and priority not in filters.priorities:
        return False
    if filters.deadline_states:
        state = deadline_state(deadline_at, status, now)
        if state not in filters.deadline_states:
            return False
    return True
