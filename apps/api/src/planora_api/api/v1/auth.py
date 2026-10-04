"""`/api/v1/auth` — unlock, lock and session read for the shared site password
(issue #124).

Thin by design: validate the body, delegate the password comparison and the
cookie value to `security.access`, rate limiting to `security.rate_limit`, and
shape the response. No profile header is involved and nothing is stored — the
cookie is a stateless signed token. These routes are public (the access gate
skips `/api/v1/auth/*`); CSRF origin checking still covers login and logout.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from planora_api.api.deps import get_access_time, get_login_limiter, get_settings
from planora_api.config import Settings
from planora_api.errors import ERROR_RESPONSE, VALIDATION_RESPONSE, ApiError
from planora_api.security import access
from planora_api.security.rate_limit import LoginRateLimiter

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
_logger = logging.getLogger("planora_api.auth")

INVALID_PASSWORD_MESSAGE = "Incorrect password."
RATE_LIMITED_MESSAGE = "Too many incorrect attempts. Try again later."

# login: wrong password, CSRF, body validation, limiter. logout: CSRF only —
# it ignores a missing or invalid cookie and is never rate limited.
_LOGIN_RESPONSES = {
    401: ERROR_RESPONSE,
    403: ERROR_RESPONSE,
    422: VALIDATION_RESPONSE,
    429: ERROR_RESPONSE,
}
_LOGOUT_RESPONSES = {403: ERROR_RESPONSE}


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


class AccessResponse(BaseModel):
    authenticated: bool


def _client_host(request: Request) -> str:
    # The ASGI client address only. With `--proxy-headers` uvicorn already
    # rewrites it from a trusted proxy; a raw X-Forwarded-For is never read.
    return request.client.host if request.client is not None else "unknown"


def _cookie_attributes(settings: Settings) -> dict[str, object]:
    return {
        "key": access.COOKIE_NAME,
        "path": "/",
        "httponly": True,
        "secure": access.cookie_is_secure(settings.app_origin),
        "samesite": "lax",
    }


@router.post("/login", response_model=AccessResponse, responses=_LOGIN_RESPONSES)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    limiter: Annotated[LoginRateLimiter, Depends(get_login_limiter)],
    now: Annotated[datetime, Depends(get_access_time)],
) -> AccessResponse:
    client = _client_host(request)
    wait = limiter.retry_after(client, now)
    if wait is not None:
        _logger.warning("Login blocked by rate limit", extra={"client_ip": client})
        raise ApiError(
            429, "RATE_LIMITED", RATE_LIMITED_MESSAGE, headers={"Retry-After": str(wait)}
        )

    if not access.password_matches(body.password, settings.app_password):
        limiter.record_failure(client, now)
        _logger.warning("Login rejected: incorrect password", extra={"client_ip": client})
        raise ApiError(401, "INVALID_PASSWORD", INVALID_PASSWORD_MESSAGE)

    limiter.reset(client)
    token = access.issue_token(
        session_secret=settings.session_secret, app_password=settings.app_password, now=now
    )
    response.set_cookie(
        value=token,
        max_age=int(access.ACCESS_LIFETIME.total_seconds()),
        **_cookie_attributes(settings),  # type: ignore[arg-type]
    )
    response.headers["Cache-Control"] = "no-store"
    return AccessResponse(authenticated=True)


@router.post("/logout", status_code=204, responses=_LOGOUT_RESPONSES)
async def logout(
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    response = Response(status_code=204, headers={"Cache-Control": "no-store"})
    response.delete_cookie(**_cookie_attributes(settings))  # type: ignore[arg-type]
    return response


@router.get("/session", response_model=AccessResponse)
async def read_session(
    request: Request,
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_access_time)],
) -> AccessResponse:
    """Whether the browser holds a valid cookie. Never 401: it is how the web
    app learns whether to show the password page."""
    response.headers["Cache-Control"] = "no-store"
    return AccessResponse(
        authenticated=access.verify_token(
            request.cookies.get(access.COOKIE_NAME),
            session_secret=settings.session_secret,
            app_password=settings.app_password,
            now=now,
        )
    )
