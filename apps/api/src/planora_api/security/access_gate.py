"""App-wide gate: every `/api/v1` route except health and auth needs the
access cookie (issue #124).

Pure ASGI, registered once in `main.create_app()` inside the CSRF middleware.
It runs before routing, dependencies and body parsing, so:
- a route added later is gated automatically, with nothing to remember;
- the check precedes profile-header validation (a locked visitor gets 401, not
  422) and the JSON body parser (a malformed body is still 401);
- no LLM call, database session or write can happen for a locked request.
Like the CSRF middleware it is deliberately not a `BaseHTTPMiddleware`, which
would hide a client disconnect from `Request.is_disconnected()` (issue #123).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime

from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from planora_api.security import access

NOT_AUTHENTICATED_CODE = "NOT_AUTHENTICATED"
NOT_AUTHENTICATED_MESSAGE = "Authentication is required."

_API_PREFIX = "/api/v1/"
_PUBLIC_PATHS = frozenset({"/api/v1/health"})
_PUBLIC_PREFIXES = ("/api/v1/auth/",)


def is_gated(path: str) -> bool:
    if not path.startswith(_API_PREFIX):
        return False
    return path not in _PUBLIC_PATHS and not path.startswith(_PUBLIC_PREFIXES)


class AccessGateMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        session_secret: str,
        app_password: str,
        clock: Callable[[], datetime],
    ) -> None:
        self.app = app
        self._session_secret = session_secret
        self._app_password = app_password
        self._clock = clock

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not is_gated(scope["path"]):
            await self.app(scope, receive, send)
            return
        token = HTTPConnection(scope).cookies.get(access.COOKIE_NAME)
        if not access.verify_token(
            token,
            session_secret=self._session_secret,
            app_password=self._app_password,
            now=self._clock(),
        ):
            response = JSONResponse(
                status_code=401,
                content={"code": NOT_AUTHENTICATED_CODE, "message": NOT_AUTHENTICATED_MESSAGE},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
