"""Portable column types shared by `db/models.py`.

Neither type imports from `sqlalchemy.dialects` or relies on a SQLite-only
type, so the same model definitions produce valid DDL for SQLite and
PostgreSQL (binding rule 4 / issue #22).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    """A timezone-aware datetime that is always stored and read back as UTC.

    SQLite has no native timezone-aware type: left to `DateTime(timezone=True)`
    alone, it silently stores and returns naive datetimes. This decorator
    normalizes on the way in (rejecting naive input, converting any
    timezone-aware offset to UTC) and re-attaches UTC on the way out, so the
    same behavior holds on SQLite and PostgreSQL.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(
        self, value: datetime | None, dialect: object
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError(
                "naive datetime is not allowed; pass a timezone-aware value"
            )
        return value.astimezone(UTC)

    def process_result_value(
        self, value: datetime | None, dialect: object
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            # SQLite returns a naive datetime; every value we ever bind was
            # converted to UTC first, so a missing tzinfo means UTC.
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)
