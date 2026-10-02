"""The public, flat API error envelope and its FastAPI handlers."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class ValidationErrorDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: str | None
    code: str
    message: str


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    message: str
    details: list[ValidationErrorDetail] | None = None


ERROR_RESPONSE = {"model": ErrorResponse, "description": "API error envelope"}
VALIDATION_RESPONSE = {"model": ErrorResponse, "description": "Invalid request fields"}
AUTH_RESPONSES = {401: ERROR_RESPONSE}
WRITE_RESPONSES = {**AUTH_RESPONSES, 403: ERROR_RESPONSE}


class ApiError(Exception):
    """An expected, safe error raised by a router or dependency."""

    def __init__(self, status_code: int, code: str, message: str, *, field: str | None = None, headers: dict[str, str] | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.field = field
        self.headers = headers or {}


def not_found(message: str) -> ApiError:
    """The standard `404 NOT_FOUND` envelope with a caller-specific message."""
    return ApiError(404, "NOT_FOUND", message)


_STATUS_ERRORS: dict[int, tuple[str, str]] = {
    400: ("BAD_REQUEST", "Invalid request."), 401: ("NOT_AUTHENTICATED", "Authentication is required."),
    404: ("NOT_FOUND", "Resource not found."),
    405: ("METHOD_NOT_ALLOWED", "Method not allowed."), 429: ("RATE_LIMITED", "Too many requests. Try again later."),
    500: ("INTERNAL_ERROR", "An unexpected error occurred."),
}
# 403 is deliberately absent: the only 403 producer today is #26's CSRF
# middleware, which returns its own `CSRF_ORIGIN_MISMATCH` JSONResponse
# directly and never reaches this table (see `security/csrf.py`). A raw
# `HTTPException(403, ...)` elsewhere falls through to the "any other
# status" fallback below — `BAD_REQUEST` — per the status-to-code table.
# (`ApiError` never consults this table at all: its handler always renders
# the caller's own `code`/`message` verbatim, whatever the status.)


def _body(code: str, message: str, details: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        body["details"] = details
    return body


def _validation_detail(error: dict[str, Any]) -> dict[str, str | None]:
    error_type = str(error.get("type", "validation_error"))
    location = list(error.get("loc", ()))
    if location and location[0] in {"body", "query", "path", "header", "cookie"}:
        location.pop(0)
    if error_type == "json_invalid":
        # A missing/malformed JSON body concerns the body as a whole. FastAPI
        # raises this with `loc = ("body", <byte offset>)` — an int, not a
        # field path — so `field` is always `None` here rather than leaking
        # that offset into the wire contract.
        field = None
    else:
        field = ".".join(str(part) for part in location) or None
    return {"field": field, "code": error_type.upper(), "message": str(error.get("msg", "Invalid value."))}


def unexpected_error_response(exc: Exception) -> JSONResponse:
    """Log the diagnostic once while returning no diagnostic to the client."""
    logger.exception("Unhandled request exception", exc_info=exc)
    code, message = _STATUS_ERRORS[500]
    return JSONResponse(status_code=500, content=_body(code, message))


def register_error_handlers(app: FastAPI) -> None:
    """Install handlers for expected, framework, validation and unexpected errors."""

    @app.exception_handler(ApiError)
    async def _handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=_body(exc.code, exc.message), headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content=_body("VALIDATION_ERROR", "Request validation failed.", [_validation_detail(error) for error in exc.errors()]))

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code, message = _STATUS_ERRORS.get(exc.status_code, _STATUS_ERRORS[400 if exc.status_code < 500 else 500])
        return JSONResponse(status_code=exc.status_code, content=_body(code, message), headers=exc.headers)

    @app.exception_handler(Exception)
    async def _handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        return unexpected_error_response(exc)
