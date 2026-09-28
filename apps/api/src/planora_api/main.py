from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Response

from planora_api.ai.client import HttpLLMClient, register_llm_error_handler
from planora_api.api.v1.ai import router as ai_router
from planora_api.api.v1.archive import router as archive_router
from planora_api.api.v1.auth import router as auth_router
from planora_api.api.v1.settings import router as settings_router
from planora_api.api.v1.tasks import router as tasks_router
from planora_api.config import Settings, load_settings
from planora_api.db.session import create_session_factory
from planora_api.errors import register_error_handlers, unexpected_error_response
from planora_api.logging import configure_logging, reset_request_id, set_request_id
from planora_api.security.csrf import CSRFOriginMiddleware, normalize_origin


def create_app(*, settings: Settings | None = None) -> FastAPI:
    # Fail fast: raises ConfigurationError before any route exists if
    # required configuration is missing or invalid. A caller building the
    # app purely to export its OpenAPI document (`planora_api.openapi`)
    # passes its own fixed placeholder `Settings` instead, so the export
    # needs no real environment.
    if settings is None:
        settings = load_settings()
    configure_logging(
        level=settings.log_level,
        secrets=(settings.session_secret, settings.llm_api_key, settings.database_url),
    )

    @asynccontextmanager
    async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
        # One shared httpx.AsyncClient for the app's whole lifetime (issue
        # #37): opened here, closed on shutdown, never built per-request.
        # No test exercises this real client for an actual request — every
        # AI test overrides `ai.deps.get_llm_client` instead (see
        # `ai/deps.py`).
        http_client = httpx.AsyncClient()
        app.state.llm_client = HttpLLMClient(
            http_client, base_url=settings.llm_base_url, api_key=settings.llm_api_key
        )
        try:
            yield
        finally:
            await http_client.aclose()

    app = FastAPI(title="Planora API", debug=False, lifespan=_lifespan)
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
    register_llm_error_handler(app)
    # No blanket `responses=` here (unlike #34's earlier draft): login,
    # logout and session read can each return a different status set —
    # `auth_router`'s own route decorators document each one precisely.
    app.include_router(auth_router)
    app.include_router(tasks_router)
    app.include_router(archive_router)
    app.include_router(settings_router)
    app.include_router(ai_router)

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

    # No path/query params and no auth dependency: nothing here can
    # produce 422, 404 or 405 (issue #34, from #27's acceptance note), so
    # none is documented.
    @app.get("/api/v1/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
