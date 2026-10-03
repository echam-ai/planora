"""App-wide request logging and `X-Request-ID` (issue #123 rewrote it as pure
ASGI).

Every HTTP request gets a fresh request id, bound to the logging context for
the request's whole lifetime and echoed as an `X-Request-ID` response header,
and produces exactly one `Request completed` log line. An exception that
escapes the app becomes the standard 500 envelope here.

This is a pure ASGI middleware on purpose. A `BaseHTTPMiddleware` hands the
app a substitute `receive`, and through it `Request.is_disconnected()` can
never see the client's `http.disconnect` — so a cancelled AI request would
keep running and be saved (`ai.deps.run_cancellable`). Here the app gets the
server's own `receive`, untouched.
"""

from __future__ import annotations

import logging
import time
import uuid

from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from planora_api.errors import unexpected_error_response
from planora_api.logging import reset_request_id, set_request_id

_HEALTH_PATH = "/api/v1/health"
_logger = logging.getLogger("planora_api.request")


def _level_for(path: str, status: int) -> int:
    if path == _HEALTH_PATH:
        return logging.DEBUG
    if status < 400:
        return logging.INFO
    return logging.WARNING if status < 500 else logging.ERROR


class RequestLoggingMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        value = str(uuid.uuid4())
        token = set_request_id(value)
        started = time.perf_counter()
        status: int | None = None

        async def send_with_request_id(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                MutableHeaders(scope=message)["X-Request-ID"] = value
            await send(message)

        try:
            try:
                await self.app(scope, receive, send_with_request_id)
            except Exception as exc:  # final API error boundary
                if status is not None:
                    # The response is already on the wire: nothing to
                    # replace. Log it as it went out and let the server see
                    # the failure.
                    self._log(scope, value, started, status)
                    raise
                response = unexpected_error_response(exc)
                await response(scope, receive, send_with_request_id)
            self._log(scope, value, started, status if status is not None else 500)
        finally:
            reset_request_id(token)

    @staticmethod
    def _log(scope: Scope, request_id: str, started: float, status: int) -> None:
        request = Request(scope)
        _logger.log(
            _level_for(request.url.path, status),
            "Request completed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 3),
                "request_id": request_id,
            },
        )
