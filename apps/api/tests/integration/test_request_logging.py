"""Characterization tests for the app-wide `request_logging` middleware
(issue #123).

Every request, whatever its outcome, gets a fresh `X-Request-ID` response
header and exactly one `Request completed` log line carrying the same id,
the method, path, status and duration, at a level chosen by the status
(health checks stay at DEBUG). These pin that behaviour so the middleware
can be a pure ASGI middleware (the disconnect fix) without drifting.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from conftest import make_client
from fastapi import FastAPI
from httpx import Response

from planora_api.logging import request_id


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


def _completed(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.getMessage() == "Request completed"]


def _build(app_factory: Callable[[], FastAPI], caplog: pytest.LogCaptureFixture) -> FastAPI:
    """`create_app()` resets the root log level from settings, so DEBUG
    capture (health checks log at DEBUG) must be requested after it."""
    app = app_factory()
    caplog.set_level(logging.DEBUG)
    return app


def _get(app: FastAPI, path: str, **kwargs: Any) -> Response:
    async def scenario() -> Response:
        async with make_client(app, **kwargs) as client:
            return await client.get(path)

    return _run(scenario)


def test_health_logs_one_debug_line_and_sets_a_uuid_request_id(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
) -> None:
    response = _get(_build(app_factory, caplog), "/api/v1/health")

    assert response.status_code == 200
    header = response.headers["X-Request-ID"]
    assert str(uuid.UUID(header)) == header
    (record,) = _completed(caplog)
    assert record.name == "planora_api.request"
    assert record.levelno == logging.DEBUG
    assert record.request_id == header  # type: ignore[attr-defined]
    assert record.method == "GET"  # type: ignore[attr-defined]
    assert record.path == "/api/v1/health"  # type: ignore[attr-defined]
    assert record.status == 200  # type: ignore[attr-defined]
    assert record.duration_ms >= 0  # type: ignore[attr-defined]


def test_each_request_gets_its_own_request_id(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = _build(app_factory, caplog)
    first = _get(app, "/api/v1/health").headers["X-Request-ID"]
    second = _get(app, "/api/v1/health").headers["X-Request-ID"]

    assert first != second
    assert [r.request_id for r in _completed(caplog)] == [first, second]  # type: ignore[attr-defined]


def test_client_error_logs_a_warning_with_the_request_id_header(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
) -> None:
    response = _get(_build(app_factory, caplog), "/api/v1/no-such-route")

    assert response.status_code == 404
    (record,) = _completed(caplog)
    assert record.levelno == logging.WARNING
    assert record.status == 404  # type: ignore[attr-defined]
    assert record.request_id == response.headers["X-Request-ID"]  # type: ignore[attr-defined]


def test_csrf_rejection_still_carries_a_request_id_and_one_log_line(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = _build(app_factory, caplog)

    async def scenario() -> Response:
        async with make_client(app, origin=None) as client:
            return await client.post("/api/v1/ai/parse-task", json={"text": "x"})

    response = _run(scenario)

    assert response.status_code == 403
    (record,) = _completed(caplog)
    assert record.status == 403  # type: ignore[attr-defined]
    assert record.request_id == response.headers["X-Request-ID"]  # type: ignore[attr-defined]


def test_unhandled_exception_becomes_a_500_envelope_with_id_and_error_log(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = _build(app_factory, caplog)

    @app.get("/api/v1/__test_only/boom")
    async def boom() -> None:
        raise RuntimeError("secret detail")

    response = _get(app, "/api/v1/__test_only/boom", raise_app_exceptions=False)

    assert response.status_code == 500
    assert "secret detail" not in response.text
    (record,) = _completed(caplog)
    assert record.levelno == logging.ERROR
    assert record.status == 500  # type: ignore[attr-defined]
    assert record.request_id == response.headers["X-Request-ID"]  # type: ignore[attr-defined]


def test_the_request_id_is_visible_to_route_code_and_cleared_afterwards(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    seen: list[str | None] = []

    @app.get("/api/v1/__test_only/rid")
    async def rid() -> dict[str, str]:
        seen.append(request_id())
        return {}

    response = _get(app, "/api/v1/__test_only/rid")

    assert seen == [response.headers["X-Request-ID"]]
    assert request_id() is None
