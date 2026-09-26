"""Server-side sessions (issue #25).

The cookie value is `secrets.token_urlsafe(32)`. Only
`HMAC-SHA256(SESSION_SECRET, token)` is ever stored, in `auth_session.
token_digest` — never the raw token — so a database read alone cannot
produce a working cookie, and rotating `SESSION_SECRET` ends every session
at once.

Every function here takes the current instant as a `now` parameter rather
than reading the clock itself, so a test can simulate the 14-day expiry
without waiting: the API layer (`api/deps.py`) is the only place this
module's callers get `now` from `datetime.now(UTC)`.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlsplit

from sqlalchemy import delete
from sqlalchemy.orm import Session

from planora_api.db.models import AuthSession

COOKIE_NAME = "planora_session"

# Fixed 14-day lifetime (spec-pinned at grooming), no sliding renewal.
SESSION_LIFETIME = timedelta(seconds=1_209_600)


def generate_token() -> str:
    """A fresh, cryptographically random cookie value."""
    return secrets.token_urlsafe(32)


def hash_token(token: str, secret: str) -> str:
    """`HMAC-SHA256(secret, token)` as a hex digest — what gets stored."""
    return hmac.new(
        secret.encode("utf-8"), token.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def create_session(db: Session, secret: str, now: datetime) -> tuple[str, AuthSession]:
    """Issue a brand-new session and return `(raw_token, row)`.

    The caller sends `raw_token` to the browser as the cookie value and
    keeps it out of any log; only the digest is persisted.
    """
    token = generate_token()
    row = AuthSession(
        token_digest=hash_token(token, secret),
        created_at=now,
        expires_at=now + SESSION_LIFETIME,
    )
    db.add(row)
    db.flush()
    return token, row


def get_valid_session(
    db: Session, token: str | None, secret: str, now: datetime
) -> AuthSession | None:
    """Return the session for `token`, or `None` if it is missing, unknown,
    minted under a different secret, or expired as of `now`."""
    if not token:
        return None
    row = db.get(AuthSession, hash_token(token, secret))
    if row is None:
        return None
    if row.expires_at <= now:
        return None
    return row


def delete_session(db: Session, token: str | None, secret: str) -> None:
    """Delete the session for `token`, if any. A no-op for a missing or
    unknown token, so callers never need to check existence first."""
    if not token:
        return
    db.execute(
        delete(AuthSession).where(AuthSession.token_digest == hash_token(token, secret))
    )


def cookie_is_secure(app_origin: str) -> bool:
    """Whether the session cookie should carry `Secure`.

    `Secure` is present for every origin except a bare `http://localhost`
    or `http://127.0.0.1` (any port) — browsers accept cookies without
    `Secure` from those over plain http for local development, and
    production always uses `https`, which cannot opt out.
    """
    parts = urlsplit(app_origin)
    is_local_http = parts.scheme == "http" and parts.hostname in (
        "localhost",
        "127.0.0.1",
    )
    return not is_local_http
