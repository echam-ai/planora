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

from datetime import UTC, datetime
from zoneinfo import ZoneInfo


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
