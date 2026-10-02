"""Local wall-clock to UTC conversion (issue #38, spec §6.1: "interprets
the entered wall-clock time in the timezone configured in Settings").

Pure — no I/O (binding rule 5). The caller supplies the naive local
datetime and an IANA timezone name; this module never reads the clock and
never touches the database. `zoneinfo` reads the installed tzdata, exactly
as `config.py`'s own timezone validation already does — not the kind of
I/O binding rule 5 is guarding against (no clock read, no network, no
database), and deterministic for a given interpreter installation.
"""

from __future__ import annotations

from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo

_DATE_ONLY_FORMAT = "%Y-%m-%d"
_DATE_TIME_FORMAT = "%Y-%m-%dT%H:%M"
# A bare date means end of day local time — the same rule #38's
# `ai.parse_task` pins for its own deadline strings; issue #41 reuses it
# exactly rather than defining a second copy.
_END_OF_DAY = time(23, 59)


def parse_local_wall_clock(value: str) -> datetime:
    """Parse `value` as a naive local wall-clock `datetime` — exactly
    `YYYY-MM-DD` (read as 23:59) or `YYYY-MM-DDTHH:MM`.

    Raises `ValueError` for anything else, including a calendar-impossible
    date or time (`strptime` itself rejects e.g. `2026-02-30` or hour
    `25`) — the same format `ai.parse_task` requires of the model's own
    `deadline` output, reused here for issue #41's `propose_create_task`/
    `propose_set_deadline` tool arguments.
    """
    if "T" in value:
        return datetime.strptime(value, _DATE_TIME_FORMAT)  # noqa: DTZ007 - deliberately naive local wall-clock
    date_only = datetime.strptime(value, _DATE_ONLY_FORMAT)  # noqa: DTZ007 - deliberately naive local wall-clock
    return datetime.combine(date_only.date(), _END_OF_DAY)


def local_wall_clock_to_utc(local_dt: datetime, timezone_name: str) -> datetime:
    """Resolve a naive local wall-clock `datetime` to its UTC instant in
    `timezone_name`.

    Raises `ValueError` if `local_dt` already carries a `tzinfo` — this
    function's whole job is interpreting a value that has none.
    `zoneinfo.ZoneInfo` itself raises if `timezone_name` names no known
    zone.

    A local time that falls in a DST gap or overlap is resolved with
    `fold=0` — zoneinfo's own default, the pre-transition UTC offset. This
    is a deliberate, simple choice (spec and grooming pin no other rule):
    a gap value is treated as if the transition had not yet happened, and
    an overlap picks its earlier of two real instants.
    """
    if local_dt.tzinfo is not None:
        raise ValueError("local_dt must be a naive (timezone-less) datetime")
    zone = ZoneInfo(timezone_name)
    aware = local_dt.replace(tzinfo=zone, fold=0)
    return aware.astimezone(UTC)


def validate_deadline_string(value: str | None) -> str | None:
    """Pass `None` or a well-formed local deadline string through; raise a
    `ValueError` (the message pydantic validators surface) otherwise."""
    if value is None:
        return None
    try:
        parse_local_wall_clock(value)
    except ValueError as exc:
        raise ValueError(
            "deadline must be a real calendar YYYY-MM-DD or YYYY-MM-DDTHH:MM value"
        ) from exc
    return value


def resolve_deadline(deadline: str | None, timezone_name: str) -> datetime | None:
    """`None` for no deadline; otherwise the UTC instant of the local
    wall-clock `deadline` in `timezone_name` (a bare date means 23:59)."""
    if deadline is None:
        return None
    return local_wall_clock_to_utc(parse_local_wall_clock(deadline), timezone_name)
