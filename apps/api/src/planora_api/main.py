from __future__ import annotations

import logging
import time
import uuid

from fastapi import FastAPI, Request, Response

from planora_api.api.v1.auth import router as auth_router
from planora_api.api.v1.tasks import router as tasks_router
from planora_api.config import load_settings
from planora_api.db.session import create_session_factory
from planora_api.errors import (
    ERROR_RESPONSE,
    VALIDATION_RESPONSE,
    register_error_handlers,
    unexpected_error_response,
)
from planora_api.logging import configure_logging, reset_request_id, set_request_id
from planora_api.security.csrf import CSRFOriginMiddleware, normalize_origin


def create_app() -> FastAPI:
    # Fail fast: raises ConfigurationError before any route exists if
    # required configuration is missing or invalid.
    settings = load_settings()
    configure_logging(
        level=settings.log_level,
        secrets=(settings.session_secret, settings.llm_api_key, settings.database_url),
    )

    app = FastAPI(title="Planora API", debug=False)
    app.state.settings = settings
    app.state.session_factory = create_session_factory(settings)

    # App-wide: covers every route below, including ones added later, and
    # runs before routing, authentication, rate limiting and body parsing
    # (issue #26) — registered before any router so a foreign-origin
    # request never reaches one.
    app.add_middleware(
        CSRFOriginMiddleware, expected_origin=normalize_origin(settings.app_origin)
    )

    register_error_handlers(app)
    app.include_router(
        auth_router,
        responses={422: VALIDATION_RESPONSE, 401: ERROR_RESPONSE, 429: ERROR_RESPONSE},
    )
    app.include_router(tasks_router)

    @app.middleware("http")
    async def request_logging(request: Request, call_next: object) -> Response:
        value = str(uuid.uuid4())
        token = set_request_id(value)
        started = time.perf_counter()
        try:
            try:
                response = await call_next(request)  # type: ignore[operator]
            except Exception as exc:  # noqa: BLE001 - final API error boundary
                response = unexpected_error_response(exc)
            response.headers["X-Request-ID"] = value
            level = logging.DEBUG if request.url.path == "/api/v1/health" else (
                logging.INFO if response.status_code < 400 else logging.WARNING if response.status_code < 500 else logging.ERROR
            )
            logging.getLogger("planora_api.request").log(
                level,
                "Request completed",
                extra={"method": request.method, "path": request.url.path, "status": response.status_code, "duration_ms": round((time.perf_counter() - started) * 1000, 3), "request_id": value},
            )
            return response
        finally:
            reset_request_id(token)

    @app.get("/api/v1/health", responses={422: VALIDATION_RESPONSE, 404: ERROR_RESPONSE, 405: ERROR_RESPONSE, 500: ERROR_RESPONSE})
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
