"""Manual ordering and cross-column moves (spec §5, §7.1).

Pure functions — no I/O (binding rule 5). This module computes `position`
values only. It never sets or reads `status`, `completed_at` or
`archived_at`: entering or leaving Done, and the archive job, belong to
tasks #29 and #32.

A *column* is the caller-supplied list of one status's active tasks, as
`(task_id, position)` pairs in display order. A *target index* is the
moved task's index in the resulting column order — for a within-column
move it matches `Board.tsx` (remove from `from`, insert at `index`); for a
cross-column move it is the insertion index among the target column's
existing tasks (0 to `len(target)` inclusive).

Positions are plain Python `float`. Every returned value is finite and no
larger than 2**53 in absolute value (round-trips exactly through a
double), matching the `Float` column #22 added. When two neighbours are
too close to split into a distinct midpoint — including when their
positions are already tied — the affected column is renumbered and every
changed position is returned so the caller persists them in one
transaction.
"""

from __future__ import annotations

import math
from collections.abc import Hashable, Sequence
from typing import Final

_MAX_ABS: Final[float] = 2.0**53
_STEP: Final[float] = 1.0
_FIRST_POSITION: Final[float] = 1.0

ColumnEntry = tuple[Hashable, float]


def _in_bounds(value: float) -> bool:
    return math.isfinite(value) and abs(value) <= _MAX_ABS


def _candidate_between(lo: float | None, hi: float | None) -> float | None:
    """A finite, in-bounds value strictly between `lo` and `hi`, or `None`
    if the gap is too small (or absent, or collapsed by a tie) to hold
    one — the caller must then renumber."""
    if lo is None and hi is None:
        return _FIRST_POSITION
    if lo is None:
        assert hi is not None
        candidate = hi - _STEP
        return candidate if candidate < hi and _in_bounds(candidate) else None
    if hi is None:
        candidate = lo + _STEP
        return candidate if candidate > lo and _in_bounds(candidate) else None
    candidate = (lo + hi) / 2.0
    if lo < candidate < hi and _in_bounds(candidate):
        return candidate
    return None


def _place(others: list[float], index: int) -> list[float]:
    """The full list of positions (length `len(others) + 1`) for `others`
    in their given order with one more task inserted at `index`.

    Tries a minimal-change insertion first (a value strictly between the
    two neighbours at `index`); falls back to renumbering every slot with
    small, evenly-spaced integers when the gap cannot hold a distinct
    value — including when the two neighbours are tied.
    """
    n = len(others)
    lo = others[index - 1] if index > 0 else None
    hi = others[index] if index < n else None
    candidate = _candidate_between(lo, hi)
    if candidate is not None:
        result = list(others)
        result.insert(index, candidate)
        return result
    return [float(slot + 1) for slot in range(n + 1)]


def _slot_after_insertion(slot: int, index: int) -> int:
    """Where an "others" entry at `slot` lands in the `_place` result once
    the new task is inserted at `index`."""
    return slot if slot < index else slot + 1


def reorder_within_column(
    column: Sequence[ColumnEntry],
    task_id: Hashable,
    index: int,
) -> dict[Hashable, float]:
    """Move `task_id` to `index` within its own column.

    `index` is the task's final index in the resulting column (matching
    `Board.tsx`: remove from its current index, insert at `index`) — from
    `0` to `len(column) - 1` inclusive.

    Returns a mapping of task id to new position holding exactly the
    tasks whose position changed. Moving to the current index is a no-op
    and returns an empty mapping.

    Raises `ValueError` for an unknown `task_id` or an `index` outside
    `[0, len(column) - 1]`; neither is clamped.
    """
    ids = [entry[0] for entry in column]
    if task_id not in ids:
        raise ValueError(f"task {task_id!r} is not in this column")
    n = len(column)
    if index < 0 or index > n - 1:
        raise ValueError(
            f"index {index} is out of range for a column of {n} task(s)"
        )

    from_index = ids.index(task_id)
    if from_index == index:
        return {}

    others = [entry for entry in column if entry[0] != task_id]
    other_positions = [position for _, position in others]
    full = _place(other_positions, index)

    changes: dict[Hashable, float] = {}
    moved_new = full[index]
    if moved_new != column[from_index][1]:
        changes[task_id] = moved_new

    for slot, (other_id, other_position) in enumerate(others):
        new_position = full[_slot_after_insertion(slot, index)]
        if new_position != other_position:
            changes[other_id] = new_position

    return changes


def move_to_column(
    source: Sequence[ColumnEntry],
    target: Sequence[ColumnEntry],
    task_id: Hashable,
    index: int,
) -> dict[Hashable, float]:
    """Move `task_id` out of `source` and into `target` at `index`.

    `index` is the insertion index among `target`'s existing tasks, from
    `0` to `len(target)` inclusive.

    Returns a mapping of task id to new position that always includes
    the moved task, plus any target-column task whose position had to
    change. It never returns an entry for a task in `source` — the
    source column's remaining order is unchanged by this function; the
    caller removes `task_id` from it.

    Raises `ValueError` if `task_id` is not in `source`, if `task_id` is
    already in `target`, or if `index` is outside
    `[0, len(target)]`; neither is clamped.
    """
    source_ids = [entry[0] for entry in source]
    if task_id not in source_ids:
        raise ValueError(f"task {task_id!r} is not in the source column")

    target_ids = [entry[0] for entry in target]
    if task_id in target_ids:
        raise ValueError(f"task {task_id!r} is already in the target column")

    n = len(target)
    if index < 0 or index > n:
        raise ValueError(
            f"index {index} is out of range for a target column of {n} task(s)"
        )

    target_positions = [position for _, position in target]
    full = _place(target_positions, index)

    changes: dict[Hashable, float] = {task_id: full[index]}
    for slot, (other_id, other_position) in enumerate(target):
        new_position = full[_slot_after_insertion(slot, index)]
        if new_position != other_position:
            changes[other_id] = new_position

    return changes


def reorder_column(
    column: Sequence[ColumnEntry], ordered_ids: Sequence[Hashable]
) -> dict[Hashable, float]:
    """Persist an explicit, full reordering of one column (spec §15.1:
    manual order survives a refresh and a new device).

    `ordered_ids` must be an exact permutation of `column`'s task ids — same
    set, no duplicate, no omission, no foreign id — checked here so a
    stale or incomplete client-sent order never reaches a partial write;
    the caller turns the resulting `ValueError` into its `422`.

    Returns a mapping of task id to new position holding only the tasks
    whose position actually changes. Reordering to the column's current
    order is a no-op and returns an empty mapping — this compares the *id
    sequence*, not raw position values, so it stays a no-op even when the
    column's existing positions aren't perfectly-spaced integers.
    """
    current_ids = [entry[0] for entry in column]

    if len(ordered_ids) != len(set(ordered_ids)):
        raise ValueError("ordered_ids contains a duplicate task id")
    if set(ordered_ids) != set(current_ids):
        raise ValueError(
            "ordered_ids must be an exact permutation of this column's "
            "active task ids"
        )

    if list(ordered_ids) == current_ids:
        return {}

    positions_by_id = dict(column)
    changes: dict[Hashable, float] = {}
    for slot, task_id in enumerate(ordered_ids):
        new_position = float(slot + 1)
        if positions_by_id[task_id] != new_position:
            changes[task_id] = new_position

    return changes
