"""CSRF protection via `Origin` header check (issue #26).

Single-origin deployment (spec §3.2, §15.1): the reverse proxy serves both
the web app and the API from one hostname, so CSRF protection reduces to
verifying that every state-changing request's `Origin` header exactly
matches the configured application origin. `CSRFOriginMiddleware` is
registered app-wide in `main.create_app()` as plain Starlette middleware —
not a FastAPI dependency — so it runs before routing, authentication, rate
limiting and body parsing: a rejected request never reaches a route, a
dependency, or the JSON body parser.

Design decisions pinned on issue #26:
- Every method except `GET`, `HEAD` and `OPTIONS` is checked. Single-origin
  deployment means no browser CORS preflight ever reaches this API, so
  `OPTIONS` needs no special handling.
- A missing `Origin` is rejected outright, with no `Referer` fallback.
  Browsers send `Origin` on every unsafe request, same-origin included.
- `Origin: null` counts as foreign — it never equals a real origin.
- The match is an exact string comparison against `APP_ORIGIN`, normalized
  once at startup (`normalize_origin`). The request's own `Origin` header
  is never normalized or otherwise parsed.
- The expected origin comes from `APP_ORIGIN` alone, never from `Host`,
  `X-Forwarded-Host`, `X-Forwarded-Proto` or `Referer`.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

# Methods this middleware never checks. They must not mutate state, so a
# foreign origin reading a resource does no harm.
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

_DEFAULT_PORT_BY_SCHEME: dict[str, int] = {"http": 80, "https": 443}

CSRF_ORIGIN_MISMATCH_CODE = "CSRF_ORIGIN_MISMATCH"
CSRF_ORIGIN_MISMATCH_MESSAGE = "This request did not come from Planora."

# The response body never echoes the request's `Origin` header — same code
# and message for a missing, `null` or foreign origin.
_MISMATCH_BODY = {
    "code": CSRF_ORIGIN_MISMATCH_CODE,
    "message": CSRF_ORIGIN_MISMATCH_MESSAGE,
}


def normalize_origin(origin: str) -> str:
    """Normalize a bare `scheme://host[:port]` origin the way a browser
    serializes its own `Origin` header: lowercase the scheme and host, and
    drop a default port (`:80` for `http`, `:443` for `https`).

    Call this exactly once, at startup, on `Settings.app_origin` — never on
    a request's `Origin` header. That lets an operator write
    `https://Planora.Example:443` in configuration and still match the
    browser's `https://planora.example`, while a request whose own header
    carries different casing or an explicit default port is still rejected
    as a mismatch (see the module docstring).
    """
    parts = urlsplit(origin)
    scheme = parts.scheme.lower()
    hostname = parts.hostname or ""
    port = parts.port
    if port is not None and port == _DEFAULT_PORT_BY_SCHEME.get(scheme):
        port = None
    netloc = hostname if port is None else f"{hostname}:{port}"
    return f"{scheme}://{netloc}"


class CSRFOriginMiddleware(BaseHTTPMiddleware):
    """Rejects every non-safe-method request whose `Origin` header does not
    exactly equal `expected_origin`, with `403 CSRF_ORIGIN_MISMATCH`.

    `expected_origin` must already be normalized (`normalize_origin`); the
    request's header is compared to it as a raw string, unmodified. A
    missing header, `Origin: null`, and any near-miss (different scheme,
    host, port, path, casing, or a multi-value list) are all rejected —
    there is no `Referer` fallback.
    """

    def __init__(self, app: ASGIApp, *, expected_origin: str) -> None:
        super().__init__(app)
        self._expected_origin = expected_origin

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if request.method in _SAFE_METHODS:
            return await call_next(request)

        # RFC 6454 gives a request one Origin value. Starlette's `.get()`
        # chooses one line when duplicates arrive, so it would let a request
        # through if the configured origin happened to be that chosen line.
        # Reject duplicates explicitly, regardless of their order.
        origins = request.headers.getlist("origin")
        if len(origins) != 1 or origins[0] != self._expected_origin:
            return JSONResponse(status_code=403, content=_MISMATCH_BODY)

        return await call_next(request)
