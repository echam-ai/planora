"""Emit the intended checks in historical migrations without rewriting history.

SQLite accepted duplicate named Enum/explicit checks in these shared revisions.
PostgreSQL rejects those tables before a new correcting revision could run.
Only the three known redundant Enum-generated checks are suppressed, leaving
the explicit canonical checks and all other migration operations untouched.
"""
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import CheckConstraint, Table, event

_CANONICAL_CHECKS = {
    "chat_message": {"ck_chat_message_role": "role IN ('user', 'assistant')"},
    "chat_action": {
        "ck_chat_action_kind": "kind IN ('create', 'update', 'move', 'schedule')",
        "ck_chat_action_status": "status IN ('pending', 'applied', 'rejected')",
    },
}


def remove_historical_enum_duplicates(table: Table, connection: object, **kwargs: object) -> None:
    if connection.dialect.name != "postgresql":
        return
    known = _CANONICAL_CHECKS.get(table.name, {})
    for name, expression in known.items():
        checks = [c for c in table.constraints if isinstance(c, CheckConstraint) and c.name == name]
        explicit = [c for c in checks if not c._type_bound and str(c.sqltext) == expression]
        generated = [c for c in checks if c._type_bound]
        if len(explicit) == len(generated) == 1:
            table.constraints.remove(generated[0])


@contextmanager
def historical_postgresql_checks() -> Iterator[None]:
    event.listen(Table, "before_create", remove_historical_enum_duplicates)
    try:
        yield
    finally:
        event.remove(Table, "before_create", remove_historical_enum_duplicates)
