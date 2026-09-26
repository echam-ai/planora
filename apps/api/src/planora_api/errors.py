"""The interim flat `{code, message}` error envelope (issue #25).

Pinned at grooming as a stand-in until #27 owns the final error envelope
and takes over these handlers in one place. `ApiError` is what a router or
dependency raises for an expected error (`401 NOT_AUTHENTICATED`,
`401 INVALID_CREDENTIALS`, `429 RATE_LIMITED`, ...); the registered
`RequestValidationError` handler replaces FastAPI's default 422 body, which
otherwise echoes the raw submitted value (including a submitted password)
in an `input` field.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    """Raised to produce `{"code", "message"}` (plus an optional `field`)
    at the given HTTP status. `headers` lets a caller attach e.g.
    `Retry-After`."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        field: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.field = field
        self.headers = headers or {}


def _error_body(code: str, message: str, field: str | None) -> dict[str, str]:
    body: dict[str, str] = {"code": code, "message": message}
    if field is not None:
        body["field"] = field
    return body


def register_error_handlers(app: FastAPI) -> None:
    """Install the exception handlers producing the flat error envelope."""

    @app.exception_handler(ApiError)
    async def _handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_error_body(exc.code, exc.message, exc.field),
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # FastAPI's default validation body includes an `input` key with
        # the raw offending value (for a missing field, the *entire* body)
        # — never forward that, or a submitted password would be echoed
        # back verbatim in a 422 response.
        first_error = exc.errors()[0]
        field_parts = [str(part) for part in first_error["loc"] if part != "body"]
        field = ".".join(field_parts) or None
        return JSONResponse(
            status_code=422,
            content=_error_body("VALIDATION_ERROR", first_error["msg"], field),
        )
