"""Unit tests for `planora_api.db.types.UTCDateTime` — pure conversion logic,
exercised directly without a database connection."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest

from planora_api.db.types import UTCDateTime

_DECORATOR = UTCDateTime()


def test_process_bind_param_passes_through_none() -> None:
    assert _DECORATOR.process_bind_param(None, dialect=None) is None


def test_process_bind_param_rejects_a_naive_datetime() -> None:
    naive = datetime(2026, 1, 1, 0, 0, 0)  # noqa: DTZ001 - deliberately naive
    with pytest.raises(ValueError, match="naive datetime"):
        _DECORATOR.process_bind_param(naive, dialect=None)


def test_process_bind_param_converts_a_non_utc_offset_to_utc() -> None:
    plus_eight = datetime(2026, 10, 1, 9, 0, 0, tzinfo=timezone(timedelta(hours=8)))

    bound = _DECORATOR.process_bind_param(plus_eight, dialect=None)

    assert bound == datetime(2026, 10, 1, 1, 0, 0, tzinfo=UTC)
    assert bound.tzinfo == UTC


def test_process_result_value_passes_through_none() -> None:
    assert _DECORATOR.process_result_value(None, dialect=None) is None


def test_process_result_value_attaches_utc_to_a_naive_value() -> None:
    # What SQLite hands back: it has no native timezone type, so a value we
    # always wrote as UTC comes back naive.
    naive = datetime(2026, 10, 1, 1, 0, 0)  # noqa: DTZ001 - deliberately naive

    result = _DECORATOR.process_result_value(naive, dialect=None)

    assert result == datetime(2026, 10, 1, 1, 0, 0, tzinfo=UTC)
    assert result.tzinfo == UTC


def test_process_result_value_normalizes_an_already_aware_value_to_utc() -> None:
    # What a dialect with native timezone support (e.g. PostgreSQL) could
    # hand back.
    plus_eight = datetime(2026, 10, 1, 9, 0, 0, tzinfo=timezone(timedelta(hours=8)))

    result = _DECORATOR.process_result_value(plus_eight, dialect=None)

    assert result == datetime(2026, 10, 1, 1, 0, 0, tzinfo=UTC)
    assert result.tzinfo == UTC
