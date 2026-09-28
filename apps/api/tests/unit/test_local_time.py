"""Unit tests for `domain.local_time` (issue #38, spec §6.1, §7.3).

Pure — no fixtures beyond plain values. Every case pins an exact UTC
instant computed independently (see the DST case's comment) rather than
asserting only "no exception".
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from planora_api.domain.local_time import local_wall_clock_to_utc


def test_singapore_offset() -> None:
    # Asia/Singapore is a fixed UTC+8 with no DST.
    result = local_wall_clock_to_utc(datetime(2026, 9, 29, 15, 0), "Asia/Singapore")  # noqa: DTZ001 - deliberately naive
    assert result == datetime(2026, 9, 29, 7, 0, tzinfo=UTC)


def test_new_york_offset_outside_dst() -> None:
    # America/New_York in late September is EDT, UTC-4.
    result = local_wall_clock_to_utc(datetime(2026, 9, 29, 15, 0), "America/New_York")  # noqa: DTZ001 - deliberately naive
    assert result == datetime(2026, 9, 29, 19, 0, tzinfo=UTC)


def test_result_is_utc_aware() -> None:
    result = local_wall_clock_to_utc(datetime(2026, 1, 1, 0, 0), "UTC")  # noqa: DTZ001 - deliberately naive
    assert result.tzinfo is UTC


def test_dst_gap_resolves_with_fold_zero() -> None:
    """2026-03-08 02:30 America/New_York falls inside the spring-forward
    gap (clocks jump from 02:00 to 03:00 that day) — it names no real
    instant. `fold=0` (zoneinfo's default) resolves it using the
    pre-transition UTC-05:00 (EST) offset, computed independently as
    `2026-03-08T07:30:00Z`."""
    result = local_wall_clock_to_utc(datetime(2026, 3, 8, 2, 30), "America/New_York")  # noqa: DTZ001 - deliberately naive
    assert result == datetime(2026, 3, 8, 7, 30, tzinfo=UTC)


def test_dst_overlap_resolves_with_fold_zero() -> None:
    """2026-11-01 01:30 America/New_York occurs twice (the fall-back
    overlap). `fold=0` picks the first (pre-transition, EDT UTC-04:00)
    occurrence."""
    result = local_wall_clock_to_utc(datetime(2026, 11, 1, 1, 30), "America/New_York")  # noqa: DTZ001 - deliberately naive
    assert result == datetime(2026, 11, 1, 5, 30, tzinfo=UTC)


def test_rejects_an_already_aware_datetime() -> None:
    with pytest.raises(ValueError, match="naive"):
        local_wall_clock_to_utc(datetime(2026, 1, 1, 0, 0, tzinfo=UTC), "UTC")


def test_rejects_an_unknown_timezone_name() -> None:
    with pytest.raises(Exception):  # noqa: B017 - zoneinfo's own exception type
        local_wall_clock_to_utc(datetime(2026, 1, 1, 0, 0), "Mars/Olympus")  # noqa: DTZ001 - deliberately naive
