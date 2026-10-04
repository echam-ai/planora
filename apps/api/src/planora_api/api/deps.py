"""Validated profile context and transactional database dependencies."""
from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from planora_api.config import Settings
from planora_api.schemas.profile import ProfileId
from planora_api.security.rate_limit import LoginRateLimiter


def get_settings(request: Request) -> Settings:
    """The `Settings` built once at app startup (`main.create_app`)."""
    return request.app.state.settings


def get_profile(
    profile: Annotated[ProfileId, Header(alias="X-Planora-Profile")],
) -> ProfileId:
    """Required explicit account context, not an authentication claim."""
    return profile


def get_db(
    request: Request, profile: Annotated[ProfileId, Depends(get_profile)],
) -> Iterator[Session]:
    """Commit before responding; rollback every failed request.

    Use DbSession, whose function scope ensures commit failures become real
    error responses. The profile is fixed for this request and never taken
    from cookies or a mutable global selected-account value.
    """
    session_factory = request.app.state.session_factory
    db = session_factory()
    db.info["profile_id"] = profile.database_id
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    else:
        db.commit()
    finally:
        db.close()


# The only supported way to depend on the database (issue #80). Every call
# site — routers and other dependencies alike — takes `db: DbSession`
# instead of writing `Depends(get_db, ...)` again; a bare `Depends(get_db)`
# would default to request scope (see `get_db`'s docstring above) and is
# guarded against mechanically by `tests/unit/test_db_dependency_scope.py`
# and `tests/integration/test_db_dependency_scope.py`.
DbSession = Annotated[Session, Depends(get_db, scope="function")]


def get_current_time() -> datetime:
    """The current instant. Overridden in tests to simulate the passage of
    time (session expiry, the rate-limit window) without waiting for it."""
    return datetime.now(UTC)


def get_access_time(request: Request) -> datetime:
    """The instant used for the access cookie and the login limiter (issue
    #124): `app.state.access_clock`, injectable via `create_app`.

    Deliberately not `get_current_time`: tests that freeze task time must not
    also change whether a cookie is still valid."""
    return request.app.state.access_clock()


def get_login_limiter(request: Request) -> LoginRateLimiter:
    """The per-process login limiter built at startup (`main.create_app`)."""
    return request.app.state.login_limiter
