"""Extends #37's sentinel logging test to `POST /api/v1/ai/parse-task`
(issue #38, spec §15.5).

At `DEBUG`, across success, invalid model output, a plain `LLMUnavailableError`
and a cancellation, none of the sentinels planted in the input text, the
model's title/content, or a URL ever appears in captured stdout, any
`caplog` record (message, `extra` fields, or traceback text), or the
response body. The only log lines expected are #37's redacted
`llm_request_*` records and the request-completion summary line — matching
`test_operator_debug_log_redaction.py`'s and
`test_llm_redaction_sentinels.py`'s established shape.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from conftest import AUTH_PASSWORD, AUTH_USERNAME, make_client
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy.orm import Session, sessionmaker
from starlette.requests import Request

from planora_api.ai import deps as ai_deps
from planora_api.ai.client import LLMCompletion, LLMUnavailableError
from planora_api.ai.deps import get_llm_client
from planora_api.ai.fake import BLOCK, FakeLLMClient
from planora_api.api.deps import get_current_time

PARSE_URL = "/api/v1/ai/parse-task"

PROMPT_SENTINEL = "SENTINEL-parse-task-prompt-4d71"
TITLE_SENTINEL = "SENTINEL-parse-task-title-8a02"
CONTENT_SENTINEL = "SENTINEL-parse-task-content-c93f"
URL_SENTINEL = "https://sentinel-url.example/f7e1b2"
ALL_SENTINELS = (PROMPT_SENTINEL, TITLE_SENTINEL, CONTENT_SENTINEL, URL_SENTINEL)


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _login(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD}
    )
    assert response.status_code == 200


def _fixed_clock(app: FastAPI, now: datetime) -> None:
    app.dependency_overrides[get_current_time] = lambda: now


def _wire_fake(app: FastAPI, script: list[Any]) -> FakeLLMClient:
    fake = FakeLLMClient(script)
    app.dependency_overrides[get_llm_client] = lambda: fake
    return fake


@pytest.fixture
def debug_env(valid_env: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    valid_env.setenv("LOG_LEVEL", "DEBUG")
    return valid_env


def _assert_no_sentinel_leaked(captured_out: str, records: list[logging.LogRecord]) -> None:
    for sentinel in ALL_SENTINELS:
        assert sentinel not in captured_out, f"{sentinel!r} leaked into stdout"
    for record in records:
        text = record.getMessage()
        if record.exc_info:
            text += "".join(str(part) for part in record.exc_info if part)
        for sentinel in ALL_SENTINELS:
            assert sentinel not in text, f"{sentinel!r} leaked into a log record"
            assert sentinel not in json.dumps(record.__dict__, default=str), (
                f"{sentinel!r} leaked into a log record's fields"
            )


def test_success_leaks_no_sentinel(
    debug_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)
    app = app_factory()
    _fixed_clock(app, datetime(2026, 9, 28, 2, 0, tzinfo=UTC))
    fake_content = json.dumps(
        {
            "title": TITLE_SENTINEL,
            "content": CONTENT_SENTINEL,
            "category": "other",
            "priority": "medium",
            "urls": [{"url": URL_SENTINEL, "label": None}],
        }
    )
    completion = LLMCompletion(
        content=fake_content, tool_calls=(), finish_reason="stop", usage=None
    )
    _wire_fake(app, [completion])
    text = f"{PROMPT_SENTINEL} do the thing, see {URL_SENTINEL}"

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(PARSE_URL, json={"text": text})

    response = _run(scenario)
    assert response.status_code == 200
    # The legitimate response to the authenticated caller carries these
    # values — only the *logs* must stay sentinel-free below.
    assert response.json()["title"] == TITLE_SENTINEL

    captured = capsys.readouterr().out
    _assert_no_sentinel_leaked(captured, caplog.records)


def test_invalid_model_output_leaks_no_sentinel(
    debug_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)
    app = app_factory()
    _fixed_clock(app, datetime(2026, 9, 28, 2, 0, tzinfo=UTC))
    # Malformed: an unknown field, carrying a sentinel — extra="forbid"
    # rejects the whole thing, but the sentinel must still never reach a
    # log line while doing so.
    fake_content = json.dumps({"title": TITLE_SENTINEL, "unexpected_field": CONTENT_SENTINEL})
    completion = LLMCompletion(
        content=fake_content, tool_calls=(), finish_reason="stop", usage=None
    )
    _wire_fake(app, [completion])
    text = f"{PROMPT_SENTINEL} do the thing"

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(PARSE_URL, json={"text": text})

    response = _run(scenario)
    assert response.status_code == 503
    for sentinel in ALL_SENTINELS:
        assert sentinel not in response.text

    captured = capsys.readouterr().out
    _assert_no_sentinel_leaked(captured, caplog.records)


def test_llm_unavailable_error_leaks_no_sentinel(
    debug_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)
    app = app_factory()
    _fixed_clock(app, datetime(2026, 9, 28, 2, 0, tzinfo=UTC))
    _wire_fake(app, [LLMUnavailableError("timeout")])
    text = f"{PROMPT_SENTINEL} do the thing"

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(PARSE_URL, json={"text": text})

    response = _run(scenario)
    assert response.status_code == 503
    for sentinel in ALL_SENTINELS:
        assert sentinel not in response.text

    captured = capsys.readouterr().out
    _assert_no_sentinel_leaked(captured, caplog.records)


def test_cancellation_leaks_no_sentinel(
    debug_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ai_deps, "_POLL_INTERVAL", 0.02)
    caplog.set_level(logging.DEBUG)
    app = app_factory()
    _fixed_clock(app, datetime(2026, 9, 28, 2, 0, tzinfo=UTC))
    _wire_fake(app, [BLOCK])
    text = f"{PROMPT_SENTINEL} do the thing"

    async def _always_disconnected(self: Request) -> bool:
        return True

    monkeypatch.setattr(Request, "is_disconnected", _always_disconnected)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(PARSE_URL, json={"text": text})

    response = _run(scenario)
    assert response.status_code == 503
    for sentinel in ALL_SENTINELS:
        assert sentinel not in response.text

    captured = capsys.readouterr().out
    _assert_no_sentinel_leaked(captured, caplog.records)
