"""Automatic archive eligibility (spec §9.1).

Pure function — no I/O (binding rule 5). The caller supplies the reference
instant; this module never reads the clock.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Final

_DONE = "done"

_ARCHIVE_WINDOW: Final[timedelta] = timedelta(days=7)


def _require_aware(value: datetime, name: str) -> None:
    if value.tzinfo is None:
        raise ValueError(
            f"{name} must be a timezone-aware datetime, not a naive one"
        )


def is_eligible_for_archive(
    status: str,
    completed_at: datetime | None,
    now: datetime,
) -> bool:
    """Whether a task's seven-day Done window (spec §9.1) has elapsed at
    instant `now`.

    `status` accepts either a `TaskStatus` member (`planora_api.db.models`)
    or its wire string, the same way `deadline.deadline_state` does.

    A task not currently Done is never eligible, even if `completed_at` is
    set and old — moving out of Done cancels the seven-day timer. A Done
    task with no `completed_at` (its window can't be established) is not
    eligible and raises no exception, so the archive job (#32) never
    crashes on it.

    Raises `ValueError` if `now`, or a non-null `completed_at`, is a naive
    datetime — matching `UTCDateTime` in `db/types.py`.
    """
    _require_aware(now, "now")
    if completed_at is not None:
        _require_aware(completed_at, "completed_at")

    if status != _DONE or completed_at is None:
        return False

    return now - completed_at >= _ARCHIVE_WINDOW
