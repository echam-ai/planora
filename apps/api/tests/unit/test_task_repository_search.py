"""Unit tests for `db.task_repository._escape_like` (issue #30, spec §9.2).

Pure string manipulation with no I/O, so it is worth pinning down without a
database: `%` and `_` must become literal characters in the resulting `LIKE`
pattern, and a literal backslash in the search term must itself survive as a
literal backslash rather than being consumed as part of an escape sequence.
"""

from __future__ import annotations

from planora_api.db.task_repository import _escape_like


def test_percent_is_escaped() -> None:
    assert _escape_like("100%") == "100\\%"


def test_underscore_is_escaped() -> None:
    assert _escape_like("a_b") == "a\\_b"


def test_plain_text_is_unchanged() -> None:
    assert _escape_like("report") == "report"


def test_backslash_is_escaped_before_percent_and_underscore() -> None:
    # If the backslash weren't escaped first, "\%" would look like an
    # already-escaped percent sign to the database instead of a literal
    # backslash followed by an escaped percent.
    assert _escape_like("\\%") == "\\\\\\%"
