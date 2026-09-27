"""The `completed_at` rule for a status change (spec §5, §9.1).

Pure function — no I/O (binding rule 5). The caller supplies the reference
instant and the previous state; this module never reads the clock or
persists anything, so #28's create and update routes and #29's move
endpoint can all call the same function instead of re-implementing the
rule three times.

`new_status`/`previous_status` accept either a `TaskStatus` member
(`planora_api.db.models`) or its wire string — this module never imports
that model, but `TaskStatus` subclasses `str`, so `TaskStatus.DONE ==
"done"` and a plain string comparison here works for both (matching
`domain/deadline.py`'s `status` parameter).
"""

from __future__ import annotations

from datetime import datetime

_DONE = "done"


def resolve_completed_at(
    *,
    new_status: str,
    previous_status: str | None,
    previous_completed_at: datetime | None,
    now: datetime,
) -> datetime | None:
    """The `completed_at` a task should carry after moving to `new_status`.

    `previous_status` is `None` for a brand-new task with no existing row
    (creation) — `previous_completed_at` is then always `None` too, which
    makes this equally correct as the create-time default (§6.1: a task
    created directly in Done gets a non-null `completed_at`).

    - Entering Done (`previous_status` was not Done, `new_status` is Done)
      sets `completed_at` to `now`.
    - Staying in Done (`previous_status` and `new_status` are both Done —
      including a PATCH that only touches other fields, which still passes
      the same `status` back in) keeps `previous_completed_at` unchanged —
      leaving a Done task in Done never resets its seven-day archive timer
      (§9.1).
    - Leaving Done, or never having been in Done, clears/keeps
      `completed_at` at `None`.
    """
    if new_status == _DONE:
        if previous_status == _DONE:
            return previous_completed_at
        return now
    return None
