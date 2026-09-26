"""Unit tests for `planora_api.domain.ordering`.

Terms match the issue's grooming: a *column* is a sequence of
`(task_id, position)` pairs in display order. A *target index* is the
moved task's index in the resulting column order — for a within-column
move it matches `Board.tsx` (remove from `from`, insert at `index`); for
a cross-column move it is the insertion index among the target column's
existing tasks.

Pure functions, no fixtures, no database, no clock.
"""

from __future__ import annotations

import math
from itertools import pairwise

import pytest

from planora_api.domain.ordering import move_to_column, reorder_within_column

MAX_ABS = 2.0**53


def _apply(column: list[tuple[str, float]], changes: dict[str, float]) -> list[tuple[str, float]]:
    """Apply a changes mapping to a column, matching the persistence step
    the caller (#29) performs."""
    return [(task_id, changes.get(task_id, pos)) for task_id, pos in column]


def _positions_in_order(column: list[tuple[str, float]]) -> list[float]:
    return [pos for _, pos in sorted(column, key=lambda entry: entry[1])]


def _ids_in_position_order(column: list[tuple[str, float]]) -> list[str]:
    return [task_id for task_id, _ in sorted(column, key=lambda entry: entry[1])]


def _assert_strictly_increasing(values: list[float]) -> None:
    assert all(a < b for a, b in pairwise(values))


def _assert_within_bounds(values: list[float]) -> None:
    for value in values:
        assert math.isfinite(value)
        assert abs(value) <= MAX_ABS


# --- Module does no I/O and touches no status fields -------------------------


def test_module_touches_no_status_or_timestamp_fields_in_code() -> None:
    """Prose in the module's own docstrings may explain *why* it avoids
    `status`, `completed_at` and `archived_at` (spec §5, §7.1) — task #29
    owns those. This inspects the AST, so it checks actual code
    identifiers and string literals, not comments or docstrings."""
    import ast

    import planora_api.domain.ordering as ordering_module

    source_path = ordering_module.__file__
    assert source_path is not None
    with open(source_path, encoding="utf-8") as handle:
        tree = ast.parse(handle.read())

    # Only identifiers used as code (a variable, parameter or attribute
    # name) count — docstrings and comments are prose, not behavior, and
    # are excluded by construction: `ast.Name`/`ast.Attribute` never
    # represent a string literal's contents.
    banned = {"status", "completed_at", "archived_at"}
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id in banned:
            found.add(node.id)
        elif isinstance(node, ast.Attribute) and node.attr in banned:
            found.add(node.attr)
    assert not found


# --- Within-column: top, bottom, no-op ---------------------------------------


def test_reorder_to_first_slot_maps_only_the_moved_task() -> None:
    column = [("A", 1.0), ("B", 2.0), ("C", 3.0)]
    result = reorder_within_column(column, "C", 0)
    assert set(result) == {"C"}
    applied = _apply(column, result)
    assert _ids_in_position_order(applied) == ["C", "A", "B"]
    _assert_strictly_increasing(_positions_in_order(applied))


def test_reorder_to_last_slot_maps_only_the_moved_task() -> None:
    column = [("A", 1.0), ("B", 2.0), ("C", 3.0)]
    result = reorder_within_column(column, "A", 2)
    assert set(result) == {"A"}
    applied = _apply(column, result)
    assert _ids_in_position_order(applied) == ["B", "C", "A"]
    _assert_strictly_increasing(_positions_in_order(applied))


def test_reorder_to_current_index_is_a_no_op() -> None:
    column = [("A", 1.0), ("B", 2.0), ("C", 3.0)]
    result = reorder_within_column(column, "B", 1)
    assert result == {}


# --- Cross-column: empty target, between two, to the end --------------------


def test_move_into_an_empty_column_maps_only_the_moved_task() -> None:
    source = [("A", 1.0), ("B", 2.0)]
    target: list[tuple[str, float]] = []
    result = move_to_column(source, target, "A", 0)
    assert set(result) == {"A"}
    assert math.isfinite(result["A"])
    assert "B" not in result


def test_move_between_two_tasks_in_another_column() -> None:
    source = [("A", 1.0)]
    target = [("X", 1.0), ("Y", 2.0)]
    result = move_to_column(source, target, "A", 1)
    applied = _apply(target, {k: v for k, v in result.items() if k != "A"})
    applied.append(("A", result["A"]))
    assert _ids_in_position_order(applied) == ["X", "A", "Y"]
    # No entry is emitted for the source column.
    assert all(task_id in {"X", "Y", "A"} for task_id in result)


def test_move_to_the_end_of_another_column() -> None:
    source = [("A", 1.0)]
    target = [("X", 1.0), ("Y", 2.0)]
    result = move_to_column(source, target, "A", 2)
    applied = _apply(target, {k: v for k, v in result.items() if k != "A"})
    applied.append(("A", result["A"]))
    ordered = _ids_in_position_order(applied)
    assert ordered[-1] == "A"


def test_cross_column_move_never_returns_a_source_entry() -> None:
    source = [("A", 1.0), ("B", 2.0), ("C", 3.0)]
    target = [("X", 1.0)]
    result = move_to_column(source, target, "B", 1)
    assert "A" not in result
    assert "C" not in result


def test_cross_column_move_always_includes_the_moved_task() -> None:
    source = [("A", 1.0)]
    target = [("X", 1.0), ("Y", 2.0)]
    result = move_to_column(source, target, "A", 1)
    assert "A" in result


# --- Out-of-range indexes, unknown ids, duplicate ids ------------------------


def test_within_column_index_above_last_slot_raises() -> None:
    column = [("A", 1.0), ("B", 2.0)]
    with pytest.raises(ValueError):
        reorder_within_column(column, "A", 2)


def test_within_column_negative_index_raises() -> None:
    column = [("A", 1.0), ("B", 2.0)]
    with pytest.raises(ValueError):
        reorder_within_column(column, "A", -1)


def test_cross_column_index_above_last_slot_raises() -> None:
    source = [("A", 1.0)]
    target = [("X", 1.0), ("Y", 2.0)]
    with pytest.raises(ValueError):
        move_to_column(source, target, "A", 3)


def test_within_column_unknown_id_raises() -> None:
    column = [("A", 1.0), ("B", 2.0)]
    with pytest.raises(ValueError):
        reorder_within_column(column, "Z", 0)


def test_cross_column_unknown_source_id_raises() -> None:
    source = [("A", 1.0)]
    target = [("X", 1.0)]
    with pytest.raises(ValueError):
        move_to_column(source, target, "Z", 0)


def test_cross_column_id_already_in_target_raises() -> None:
    source = [("A", 1.0)]
    target = [("A", 5.0), ("X", 1.0)]
    with pytest.raises(ValueError):
        move_to_column(source, target, "A", 0)


# --- Tied input positions -----------------------------------------------------


def test_tied_positions_are_resolved_into_strictly_increasing_order() -> None:
    column = [("A", 1.0), ("B", 1.0), ("C", 2.0)]
    result = reorder_within_column(column, "C", 1)
    applied = _apply(column, result)
    assert _ids_in_position_order(applied) == ["A", "C", "B"]
    _assert_strictly_increasing(_positions_in_order(applied))


# --- Float storage: bounds, renumbering, 200-insert scenarios ----------------


def test_positions_are_plain_finite_floats_within_bounds() -> None:
    column = [("A", 1.0), ("B", 2.0), ("C", 3.0)]
    result = reorder_within_column(column, "C", 0)
    for value in result.values():
        assert isinstance(value, float)
        assert math.isfinite(value)
        assert abs(value) <= MAX_ABS


def _apply_and_resort(
    column: list[tuple[str, float]],
    new_id: str,
    changes: dict[str, float],
) -> list[tuple[str, float]]:
    """Apply `changes` (as #29 would persist them) to `column` plus the
    newly-inserted `new_id`, then re-derive display order from the
    resulting positions — the next iteration's input must be in true
    display order, not literal list-append order."""
    with_new = [*column, (new_id, changes[new_id])]
    applied = _apply(with_new, changes)
    return sorted(applied, key=lambda entry: entry[1])


def test_repeated_inserts_at_the_first_slot_stay_strictly_increasing() -> None:
    target: list[tuple[str, float]] = [("orig1", 1.0), ("orig2", 2.0), ("orig3", 3.0)]
    for i in range(200):
        new_id = f"new{i}"
        source = [(new_id, 0.0)]
        result = move_to_column(source, target, new_id, 0)
        assert new_id in result
        target = _apply_and_resort(target, new_id, result)
        ordered = _positions_in_order(target)
        _assert_strictly_increasing(ordered)
        _assert_within_bounds(ordered)
        assert _ids_in_position_order(target)[0] == new_id


def test_repeated_inserts_at_index_one_exhaust_the_midpoint_and_renumber() -> None:
    target: list[tuple[str, float]] = [("orig1", 1.0), ("orig2", 2.0)]
    saw_multi_key_renumber = False
    for i in range(200):
        new_id = f"new{i}"
        source = [(new_id, 0.0)]
        result = move_to_column(source, target, new_id, 1)
        assert new_id in result
        if len(result) > 1:
            saw_multi_key_renumber = True
        target = _apply_and_resort(target, new_id, result)
        ordered_ids = _ids_in_position_order(target)
        ordered_positions = _positions_in_order(target)
        assert ordered_ids[0] == "orig1"
        assert ordered_ids[1] == new_id
        _assert_strictly_increasing(ordered_positions)
        _assert_within_bounds(ordered_positions)
    assert saw_multi_key_renumber
