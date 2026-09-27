"""Contract tests for issue #27's API error envelope."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any, Literal

import pytest
from conftest import make_client
from fastapi import FastAPI, HTTPException
from httpx import Response
from pydantic import BaseModel, Field


def _run(coro: object) -> object:
    return asyncio.run(coro)  # type: ignore[arg-type]


def test_unknown_route_uses_the_flat_not_found_envelope(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.get("/api/v1/does-not-exist")

    response = _run(scenario())
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"code": "NOT_FOUND", "message": "Resource not found."}


def test_validation_errors_are_redacted_and_use_wire_field_names(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()
    sentinel = "do-not-echo-this-username"

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.post("/api/v1/auth/login", json={"username": sentinel})

    response = _run(scenario())
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert response.json()["details"] == [
        {"field": "password", "code": "MISSING", "message": "Field required"}
    ]
    assert sentinel not in response.text


def test_wrong_method_keeps_allow_header_and_openapi_uses_error_components(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.delete("/api/v1/health")

    response = _run(scenario())
    assert response.status_code == 405
    assert response.headers["allow"] == "GET"
    assert response.json()["code"] == "METHOD_NOT_ALLOWED"

    schemas = app.openapi()["components"]["schemas"]
    assert {"ErrorResponse", "ValidationErrorDetail"} <= schemas.keys()
    assert "HTTPValidationError" not in schemas
    login_422 = app.openapi()["paths"]["/api/v1/auth/login"]["post"]["responses"]["422"]
    assert login_422["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")


def test_unhandled_exception_is_generic_and_has_a_request_id(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()
    sentinel = "internal-error-sentinel"

    @app.get("/api/v1/__test_only/fail")
    def fail() -> None:
        raise RuntimeError(sentinel)

    async def scenario() -> Response:
        async with make_client(app, raise_app_exceptions=False) as client:
            return await client.get("/api/v1/__test_only/fail")

    response = _run(scenario())
    assert response.status_code == 500
    assert response.json() == {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred."}
    assert response.headers["x-request-id"]
    assert sentinel not in response.text


def test_unhandled_exception_logs_exactly_one_error_line_with_the_request_id_and_traceback(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    app = app_factory()
    sentinel = "internal-error-traceback-sentinel"
    caplog.set_level(logging.DEBUG)

    @app.get("/api/v1/__test_only/fail_loudly")
    def fail_loudly() -> None:
        raise RuntimeError(sentinel)

    async def scenario() -> Response:
        async with make_client(app, raise_app_exceptions=False) as client:
            return await client.get("/api/v1/__test_only/fail_loudly")

    response = _run(scenario())
    request_id = response.headers["x-request-id"]

    # Two ERROR-level lines are expected for a 500: the diagnostic exception
    # log this criterion is about, and the request-completion summary line
    # (ERROR because the response is 5xx, per the structured-logging
    # criteria) with no `exc_info`. "Logged once" means the diagnostic
    # itself is not duplicated.
    diagnostic_records = [
        record
        for record in caplog.records
        if record.levelno == logging.ERROR and record.exc_info is not None
    ]
    assert len(diagnostic_records) == 1

    # `request_id` is only stamped onto the rendered line (it comes from a
    # contextvar read inside `JsonFormatter.format`, not the `LogRecord`
    # itself) — so the real stdout output, what an operator actually reads,
    # is what proves it matches the response header.
    captured = capsys.readouterr()
    parsed_lines = [json.loads(line) for line in captured.out.splitlines() if line.strip()]
    diagnostic_lines = [line for line in parsed_lines if "traceback" in line]
    assert len(diagnostic_lines) == 1
    assert diagnostic_lines[0]["level"] == "ERROR"
    assert diagnostic_lines[0]["request_id"] == request_id
    assert "Traceback" in diagnostic_lines[0]["traceback"]
    assert "RuntimeError" in diagnostic_lines[0]["traceback"]


def test_malformed_json_body_reports_a_null_field_and_never_echoes_the_sentinel(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = app_factory()
    sentinel = "SENTINEL-malformed-json-body"
    caplog.set_level(logging.DEBUG)

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.post(
                "/api/v1/auth/login",
                content=f'{{"password": "{sentinel}"'.encode(),
                headers={"Content-Type": "application/json"},
            )

    response = _run(scenario())

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert sentinel not in response.text
    assert len(body["details"]) == 1
    detail = body["details"][0]
    assert detail["field"] is None
    assert detail["code"] == "JSON_INVALID"
    assert set(detail.keys()) == {"field", "code", "message"}
    assert detail["message"]

    for record in caplog.records:
        assert sentinel not in record.getMessage()


# --- Validation-kind coverage --------------------------------------------
#
# The app's only current body model (`LoginRequest`) has two plain string
# fields, so it alone can't exercise "too long", "invalid enum/literal",
# "unparsable datetime" or "unparsable integer" — pydantic error kinds the
# issue requires coverage for. A test-only route (kept off the production
# app, like `/__test_only/fail` above) with one field per kind lets each
# be triggered in isolation.


class _ValidationScenarioBody(BaseModel):
    short_field: str = Field(max_length=5)
    color: Literal["red", "green"]
    when: datetime
    count: int


_VALID_SCENARIO_BODY: dict[str, Any] = {
    "short_field": "ok",
    "color": "red",
    "when": "2024-01-01T00:00:00Z",
    "count": 1,
}


def _register_validation_scenario_route(app: FastAPI) -> None:
    @app.post("/api/v1/__test_only/validate")
    def validate_scenario(body: _ValidationScenarioBody) -> None:
        return None


@pytest.mark.parametrize(
    ("field", "invalid_value", "expected_code"),
    [
        ("short_field", "too-long-SENTINEL-VALUE", "STRING_TOO_LONG"),
        ("color", "SENTINEL-not-a-known-color", "LITERAL_ERROR"),
        ("when", "SENTINEL-not-a-datetime", "DATETIME_FROM_DATE_PARSING"),
        ("count", "SENTINEL-not-an-integer", "INT_PARSING"),
    ],
)
def test_validation_error_kinds_report_the_pydantic_type_with_no_echo(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    field: str,
    invalid_value: str,
    expected_code: str,
) -> None:
    app = app_factory()
    _register_validation_scenario_route(app)
    payload = {**_VALID_SCENARIO_BODY, field: invalid_value}

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.post("/api/v1/__test_only/validate", json=payload)

    response = _run(scenario())

    assert response.status_code == 422
    assert invalid_value not in response.text
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert len(body["details"]) == 1
    detail = body["details"][0]
    assert detail["field"] == field
    assert detail["code"] == expected_code
    assert set(detail.keys()) == {"field", "code", "message"}


def test_raw_http_exception_with_unlisted_403_renders_bad_request(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()

    @app.get("/api/v1/__test_only/forbidden")
    def forbidden() -> None:
        raise HTTPException(status_code=403, detail="you may not pass")

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.get("/api/v1/__test_only/forbidden")

    response = _run(scenario())

    assert response.status_code == 403
    assert response.json() == {"code": "BAD_REQUEST", "message": "Invalid request."}
    assert "you may not pass" not in response.text


def test_request_log_for_health_omits_the_query_string_entirely(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    valid_env.setenv("LOG_LEVEL", "DEBUG")
    app = app_factory()
    sentinel = "SENTINEL-query-string-value"
    # Test-harness noise, not production behavior: `httpx.AsyncClient` (the
    # test client driving this request) logs its own outgoing request line
    # at INFO through the standard `logging` module, which propagates to
    # the same root handler this test inspects. A real deployment has no
    # such client-side logger — there is no httpx client making requests to
    # itself — so silence it here rather than let it manufacture a "leak"
    # that the application itself never produces.
    logging.getLogger("httpx").setLevel(logging.WARNING)

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.get(f"/api/v1/health?q={sentinel}")

    response = _run(scenario())
    assert response.status_code == 200

    captured = capsys.readouterr()
    assert sentinel not in captured.out
    parsed_lines = [json.loads(line) for line in captured.out.splitlines() if line.strip()]
    request_lines = [line for line in parsed_lines if line.get("path") == "/api/v1/health"]
    assert len(request_lines) == 1
    request_line = request_lines[0]
    assert request_line["status"] == 200
    assert isinstance(request_line["duration_ms"], (int, float))
    assert sentinel not in json.dumps(request_line)


def test_csrf_origin_mismatch_still_renders_its_own_403_envelope(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app, origin="https://foreign.example") as client:
            return await client.post("/api/v1/auth/logout")

    response = _run(scenario())

    assert response.status_code == 403
    assert response.json() == {
        "code": "CSRF_ORIGIN_MISMATCH",
        "message": "This request did not come from Planora.",
    }
