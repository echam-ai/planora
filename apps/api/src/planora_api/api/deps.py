"""Shared FastAPI dependencies (issue #25).

`require_session` is the reusable dependency #28-#31 mount on their
protected routes. `get_current_time` exists purely so a test can override
it with a fixed clock (`app.dependency_overrides[get_current_time] = ...`)
instead of waiting real minutes for a session or a rate-limit window to
expire.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker

from planora_api.config import Settings
from planora_api.db.models import AuthSession
from planora_api.errors import ApiError
from planora_api.security import session as session_security


def get_settings(request: Request) -> Settings:
    """The `Settings` built once at app startup (`main.create_app`)."""
    return request.app.state.settings


def get_session_factory(request: Request) -> sessionmaker[Session]:
    """The app's session factory (`main.create_app`), for a caller that
    needs its own short-lived transaction outside the request-scoped
    session `get_db` yields — e.g. `security.rate_limit`, whose failure
    record must survive the `401`/`429` response it precedes even though
    that response's own transaction rolls back.

    SQLite single-writer hazard: don't call `session_factory()` for a
    second, independent transaction while the request's own `get_db`
    session still holds an open one — even a read-only `SELECT` begins a
    transaction that isn't released until that session commits or rolls
    back. On SQLite, two connections can't both hold an open transaction
    on the same file; the second connection's commit blocks on the
    first's lock, which won't release until the request finishes — the
    same request that's blocked waiting on that commit
    (`sqlite3.OperationalError: database is locked`, or a hang). Release
    the request's own session first — `db.rollback()` if nothing on it is
    worth keeping, `db.commit()` if something is — before opening a
    transaction through this factory. See `api.v1.auth.login` for the
    pattern.
    """
    return request.app.state.session_factory


def get_db(request: Request) -> Iterator[Session]:
    """A transactional request-scoped database session.

    **Contract**: commits before the response is sent, and rolls back on
    any exception — `ApiError` included; an error response is not a
    license to keep a write a route made before deciding to fail. A write
    that must survive its own route's `ApiError` (the rate limiter's
    recorded failure) uses its own short transaction via
    `get_session_factory` instead of piggybacking on this one.

    **Every `Depends(get_db)` must pass `scope="function"`.** In the
    FastAPI version pinned here (0.141.1), a `yield` dependency defaults to
    request scope, whose post-yield code runs *after* the response has
    already been sent over the wire — so a failing commit there cannot
    turn into an error response; the client already received a 2xx body
    (and, for login, a `Set-Cookie` for a session that was never actually
    saved). `scope="function"` runs the post-yield code — this commit —
    before the response is produced, so a failed commit becomes a real
    error response and no `Set-Cookie` (or any other header/body already
    staged on the response object) reaches the client. Every dependency
    that resolves `get_db` transitively (`get_current_session`,
    `require_session`) inherits this correctly as long as the one edge
    that actually depends on `get_db` — inside `get_current_session` — uses
    `scope="function"`; neither of those two is itself a generator, so
    they carry no scope of their own. Mixing scoped and unscoped
    `Depends(get_db)` in the same app is worse than using the wrong one
    consistently: FastAPI caches a dependency by `(call, scope)`, so the
    two variants are cached separately and would open two *separate*
    sessions/transactions for what should be one request.
    """
    session_factory = request.app.state.session_factory
    db = session_factory()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    else:
        db.commit()
    finally:
        db.close()


def get_current_time() -> datetime:
    """The current instant. Overridden in tests to simulate the passage of
    time (session expiry, the rate-limit window) without waiting for it."""
    return datetime.now(UTC)


def get_current_session(
    request: Request,
    db: Annotated[Session, Depends(get_db, scope="function")],
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_current_time)],
) -> AuthSession | None:
    """The session for the request's cookie, or `None` if there isn't a
    valid one. Deliberately returns `None` rather than raising — "signed
    out" is a valid answer, not an error (used directly by `GET
    /api/v1/auth/session`)."""
    token = request.cookies.get(session_security.COOKIE_NAME)
    return session_security.get_valid_session(db, token, settings.session_secret, now)


def require_session(
    session: Annotated[AuthSession | None, Depends(get_current_session)],
) -> AuthSession:
    """The reusable dependency for a route that requires a signed-in caller.

    Raises `401 NOT_AUTHENTICATED` for a missing, invalid or expired
    cookie; otherwise passes the session through.
    """
    if session is None:
        raise ApiError(401, "NOT_AUTHENTICATED", "Sign in required.")
    return session
