"""Deadline state derivation (spec §7.3).

Pure function — no I/O (binding rule 5). The caller supplies the reference
instant; this module never reads the clock, so the same arguments always
produce the same result.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Final, Literal

DeadlineState = Literal["none", "scheduled", "due_soon", "overdue", "completed"]

_DONE = "done"

_DUE_SOON_WINDOW: Final[timedelta] = timedelta(hours=24)


def _require_aware(value: datetime, name: str) -> None:
    if value.tzinfo is None:
        raise ValueError(
            f"{name} must be a timezone-aware datetime, not a naive one"
        )


def deadline_state(
    deadline_at: datetime | None,
    status: str,
    now: datetime,
) -> DeadlineState:
    """Derive the deadline state (spec §7.3) for one task at instant `now`.

    `status` accepts either a `TaskStatus` member (`planora_api.db.models`)
    or its wire string — this module never imports that model, but
    `TaskStatus` subclasses `str`, so `TaskStatus.DONE == "done"` and a
    plain string comparison here works for both.

    `Completed` takes precedence over every other state: a Done task
    returns `"completed"` regardless of its deadline, including a null or
    past one (spec §17 criterion 24 — a Done task is never overdue).

    Raises `ValueError` if `now`, or a non-null `deadline_at`, is a naive
    datetime — matching `UTCDateTime` in `db/types.py`.
    """
    _require_aware(now, "now")
    if deadline_at is not None:
        _require_aware(deadline_at, "deadline_at")

    if status == _DONE:
        return "completed"
    if deadline_at is None:
        return "none"

    remaining = deadline_at - now
    if remaining < timedelta(0):
        return "overdue"
    if remaining <= _DUE_SOON_WINDOW:
        return "due_soon"
    return "scheduled"
