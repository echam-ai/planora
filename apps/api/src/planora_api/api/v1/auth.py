"""`/api/v1/auth` — login, logout and session read (issue #25).

Thin by design: this module validates the request, delegates hashing to
`security.password`, sessions to `security.session`, and rate limiting to
`security.rate_limit`, and shapes the response. It imports each of those as
a module (not their individual functions) so a test can monkeypatch a
function on the module object — e.g. spying on
`password_security.verify_password` — and have this router's own call
resolve through that patched attribute.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session, sessionmaker

from planora_api.api.deps import (
    DbSession,
    get_current_session,
    get_current_time,
    get_session_factory,
    get_settings,
)
from planora_api.config import Settings
from planora_api.db import auth_repository
from planora_api.db.models import AuthSession
from planora_api.errors import ERROR_RESPONSE, VALIDATION_RESPONSE, ApiError
from planora_api.security import password as password_security
from planora_api.security import rate_limit
from planora_api.security import session as session_security

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

_INVALID_CREDENTIALS_MESSAGE = "Incorrect username or password."

# Every mutating (POST/PUT/PATCH/DELETE) route documents 403: #26's CSRF
# middleware can return `CSRF_ORIGIN_MISMATCH` for any of them (issue #34,
# from #27's acceptance note).
#
# `login` additionally keeps 401 (wrong credentials), 422 (body
# validation) and 429 (the rate limiter) — all three are real outcomes of
# this route. `logout` documents nothing else: it has no body to fail
# validation on, ignores a missing/invalid cookie rather than rejecting it,
# and isn't rate-limited, so it always returns 204. `GET /session` needs no
# entry here — it takes no session dependency that could raise 401 (a
# signed-out caller gets `200 null`, not an error) and no rate limiting.
_LOGIN_RESPONSES = {
    401: ERROR_RESPONSE,
    403: ERROR_RESPONSE,
    422: VALIDATION_RESPONSE,
    429: ERROR_RESPONSE,
}
_LOGOUT_RESPONSES = {403: ERROR_RESPONSE}


class LoginRequest(BaseModel):
    username: str
    password: str


class SessionResponse(BaseModel):
    username: str
    signed_in_at: str


def _client_ip(request: Request) -> str:
    return request.client.host if request.client is not None else "unknown"


def _set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=session_security.COOKIE_NAME,
        value=token,
        max_age=int(session_security.SESSION_LIFETIME.total_seconds()),
        path="/",
        httponly=True,
        secure=session_security.cookie_is_secure(settings.app_origin),
        samesite="Lax",
    )


def _clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=session_security.COOKIE_NAME,
        path="/",
        httponly=True,
        secure=session_security.cookie_is_secure(settings.app_origin),
        samesite="Lax",
    )


@router.post("/login", response_model=SessionResponse, responses=_LOGIN_RESPONSES)
def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_current_time)],
    session_factory: Annotated[sessionmaker[Session], Depends(get_session_factory)],
) -> SessionResponse:
    client_ip = _client_ip(request)

    wait_seconds = rate_limit.seconds_until_unblocked(db, client_ip, now)
    if wait_seconds is not None:
        raise ApiError(
            429,
            "RATE_LIMITED",
            "Too many failed login attempts. Try again later.",
            headers={"Retry-After": str(wait_seconds)},
        )

    user = auth_repository.get_app_user(db)
    is_known_user = user is not None and body.username == user.username
    hash_to_check = user.password_hash if is_known_user else password_security.DUMMY_PASSWORD_HASH

    # Exactly one Argon2 verification either way, against a real user's
    # hash or the fixed dummy hash — so an unknown username and a wrong
    # password cost the same time and return the same body.
    password_ok = password_security.verify_password(hash_to_check, body.password)

    if not is_known_user or not password_ok:
        # `db` has only read so far; release it (nothing to lose) before
        # `record_failure` opens its own connection — see
        # `get_session_factory`'s docstring for why.
        db.rollback()
        # Committed in its own transaction (`session_factory`, not `db`) —
        # it must survive the `ApiError` below rolling back this request's
        # own session.
        rate_limit.record_failure(session_factory, client_ip, now)
        raise ApiError(401, "INVALID_CREDENTIALS", _INVALID_CREDENTIALS_MESSAGE)

    assert user is not None  # is_known_user implies this
    if password_security.needs_rehash(user.password_hash):
        user.password_hash = password_security.hash_password(body.password)
        user.updated_at = now

    # Persist the rehash above (if any) and release `db` before
    # `clear_failures` opens its own connection — see
    # `get_session_factory`'s docstring for why.
    db.commit()
    rate_limit.clear_failures(session_factory, client_ip)

    # Session fixation (issue #25): a caller presenting a still-valid
    # cookie gets a brand-new token on login, and the old one is revoked.
    session_security.delete_session(db, request.cookies.get(session_security.COOKIE_NAME), settings.session_secret)

    token, row = session_security.create_session(db, settings.session_secret, now)
    _set_session_cookie(response, token, settings)

    return SessionResponse(username=user.username, signed_in_at=row.created_at.isoformat())


@router.post("/logout", status_code=204, responses=_LOGOUT_RESPONSES)
def logout(
    request: Request,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    session_security.delete_session(
        db, request.cookies.get(session_security.COOKIE_NAME), settings.session_secret
    )
    response = Response(status_code=204)
    _clear_session_cookie(response, settings)
    return response


@router.get("/session", response_model=SessionResponse | None)
def read_session(
    session: Annotated[AuthSession | None, Depends(get_current_session)],
    db: DbSession,
) -> SessionResponse | None:
    if session is None:
        return None
    user = auth_repository.get_app_user(db)
    if user is None:
        # The account was deleted out from under a still-valid session —
        # not reachable through #25's own endpoints, but never trust a
        # session row to imply a user row exists.
        return None
    return SessionResponse(username=user.username, signed_in_at=session.created_at.isoformat())
