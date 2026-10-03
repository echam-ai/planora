"""Explicit repository context, separate from credentials or access control.

HTTP sessions always receive a validated profile in api.deps.get_db.
Direct repository callers default to the legacy Knight profile; the hourly
archive candidate query intentionally covers both profiles. Every scoped
query includes its owner predicate, even primary-key/identity-map reads.
"""
from sqlalchemy.orm import Session


def profile_id(db: Session) -> int:
    return db.info.get("profile_id", 1)
