"""Repository functions for the single `app_user` row (issue #25).

`get_app_user` is read-only and used by the login/session endpoints in
`api/v1/auth.py`. `upsert_app_user` creates or replaces the single row —
#25 never calls it itself (no user is created here); #33's account-creation
and password-reset command is its only caller until #31 (password change)
adds a second one.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from planora_api.db.models import AppUser

# `app_user.id` is always 1 — the table's `CHECK (id = 1)` constraint allows
# no other value (spec §3.1: exactly one account).
_SINGLE_USER_ID = 1


def get_app_user(db: Session) -> AppUser | None:
    """Return the single account row, or `None` if it does not exist yet."""
    return db.get(AppUser, _SINGLE_USER_ID)


def upsert_app_user(
    db: Session, *, username: str, password_hash: str, now: datetime
) -> AppUser:
    """Create the single account, or replace its credentials in place.

    Keyed by the fixed id `1`, so this always affects the one allowed row —
    never a second one.
    """
    user = db.get(AppUser, _SINGLE_USER_ID)
    if user is None:
        user = AppUser(
            id=_SINGLE_USER_ID,
            username=username,
            password_hash=password_hash,
            created_at=now,
            updated_at=now,
        )
        db.add(user)
    else:
        user.username = username
        user.password_hash = password_hash
        user.updated_at = now
    db.flush()
    return user
