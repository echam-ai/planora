"""Sentinel test for issue #37 (spec §15.5): nothing sensitive reaches the
logs, a traceback, or the `503` body, at `DEBUG`, across a successful call,
a timeout, a `500` whose body echoes the prompt, a `200` with a malformed
body containing the completion sentinel, and a cancellation.

Follows `test_operator_debug_log_redaction.py`'s shape: drive the request
through the real, configured logging pipeline (`app_factory()`, which
calls the real `main.create_app()` -> `configure_logging()`), then assert
none of the five sentinels appears in captured stdout, in any `caplog`
record, or in the response body.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Annotated

import httpx
import pytest
from conftest import make_client
from fastapi import Depends, FastAPI
from httpx import Response

from planora_api.ai import deps as ai_deps
from planora_api.ai.client import HttpLLMClient, LLMClient, LLMUnavailableError
from planora_api.ai.deps import get_llm_client, run_cancellable
from planora_api.ai.fake import BLOCK, FakeLLMClient

KEY_SENTINEL = "SENTINEL-llm-api-key-9f2c"
PROMPT_SENTINEL = "SENTINEL-user-prompt-7d1a"
TASK_TITLE_SENTINEL = "SENTINEL-task-title-3b8e"
COMPLETION_SENTINEL = "SENTINEL-completion-content-5e91"
TOOL_ARG_SENTINEL = "SENTINEL-tool-argument-2c47"
ALL_SENTINELS = (
    KEY_SENTINEL,
    PROMPT_SENTINEL,
    TASK_TITLE_SENTINEL,
    COMPLETION_SENTINEL,
    TOOL_ARG_SENTINEL,
)

_MESSAGES = [
    {"role": "user", "content": PROMPT_SENTINEL},
    {"role": "user", "content": TASK_TITLE_SENTINEL},
]


@pytest.fixture
def debug_env(valid_env: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    valid_env.setenv("LOG_LEVEL", "DEBUG")
    valid_env.setenv("LLM_API_KEY", KEY_SENTINEL)
    valid_env.setenv("LLM_BASE_URL", "https://llm.invalid/v1")
    return valid_env


@pytest.fixture(autouse=True)
def _forbid_real_network(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _blow_up(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("real network transport must never be exercised in tests")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _blow_up)


def _run(coro_fn: Callable[[], Awaitable[object]]) -> object:
    return asyncio.run(coro_fn())


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


def _mock_client(handler: Callable[[httpx.Request], httpx.Response]) -> HttpLLMClient:
    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return HttpLLMClient(http_client, base_url="https://llm.invalid/v1", api_key=KEY_SENTINEL)


def _wire_ask_route(app: FastAPI, client: LLMClient) -> None:
    app.dependency_overrides[get_llm_client] = lambda: client

    @app.post("/api/v1/__test_only/ask")
    async def ask(bound: Annotated[LLMClient, Depends(get_llm_client)]) -> dict[str, str | None]:
        result = await bound.complete(_MESSAGES, model="m")
        return {"content": result.content}


def test_success_leaks_no_sentinel(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)
    app = app_factory()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": COMPLETION_SENTINEL,
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {
                                        "name": "do_thing",
                                        "arguments": json.dumps({"note": TOOL_ARG_SENTINEL}),
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            },
        )

    _wire_ask_route(app, _mock_client(handler))

    async def scenario() -> Response:
        async with make_client(app) as http:
            return await http.post("/api/v1/__test_only/ask")

    response = _run(scenario)
    assert response.status_code == 200
    # The assistant's own answer legitimately reaches the authenticated
    # caller — only the *logs* must stay sentinel-free below.
    assert response.json() == {"content": COMPLETION_SENTINEL}

    captured = capsys.readouterr().out
    _assert_no_sentinel_leaked(captured, caplog.records)


def test_timeout_leaks_no_sentinel(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)
    app = app_factory()

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    _wire_ask_route(app, _mock_client(handler))

    async def scenario() -> Response:
        async with make_client(app) as http:
            return await http.post("/api/v1/__test_only/ask")

    response = _run(scenario)
    assert response.status_code == 503
    for sentinel in ALL_SENTINELS:
        assert sentinel not in response.text

    captured = capsys.readouterr().out
    _assert_no_sentinel_leaked(captured, caplog.records)


def test_500_that_echoes_the_prompt_leaks_no_sentinel(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)
    app = app_factory()

    def handler(request: httpx.Request) -> httpx.Response:
        # The upstream provider's own error body echoes the caller's
        # prompt back — exactly the kind of body that must never reach a
        # log line or the client-facing response.
        return httpx.Response(500, json={"error": f"rejected prompt: {PROMPT_SENTINEL}"})

    _wire_ask_route(app, _mock_client(handler))

    async def scenario() -> Response:
        async with make_client(app) as http:
            return await http.post("/api/v1/__test_only/ask")

    response = _run(scenario)
    assert response.status_code == 503
    assert response.json() == {
        "code": "AI_UNAVAILABLE",
        "message": "The assistant is unavailable right now. Try again.",
    }
    for sentinel in ALL_SENTINELS:
        assert sentinel not in response.text

    captured = capsys.readouterr().out
    _assert_no_sentinel_leaked(captured, caplog.records)


def test_malformed_200_leaks_no_sentinel(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)
    app = app_factory()

    def handler(request: httpx.Request) -> httpx.Response:
        # `content` must be `str | None` — a dict makes this malformed,
        # while still carrying the completion sentinel inside the raw body
        # httpx receives (never inside anything this module logs).
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {"content": {"unexpected": COMPLETION_SENTINEL}},
                        "finish_reason": "stop",
                    }
                ]
            },
        )

    _wire_ask_route(app, _mock_client(handler))

    async def scenario() -> Response:
        async with make_client(app) as http:
            return await http.post("/api/v1/__test_only/ask")

    response = _run(scenario)
    assert response.status_code == 503
    for sentinel in ALL_SENTINELS:
        assert sentinel not in response.text

    captured = capsys.readouterr().out
    _assert_no_sentinel_leaked(captured, caplog.records)


class _FakeDisconnectRequest:
    """A minimal stand-in for `fastapi.Request`: only `is_disconnected()`
    is used by `run_cancellable`."""

    def __init__(self, disconnect_event: asyncio.Event) -> None:
        self._event = disconnect_event

    async def is_disconnected(self) -> bool:
        return self._event.is_set()


def test_cancellation_leaks_no_sentinel(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ai_deps, "_POLL_INTERVAL", 0.02)
    caplog.set_level(logging.DEBUG)
    app_factory()  # runs the real configure_logging() for this test
    fake = FakeLLMClient([BLOCK])

    async def scenario() -> None:
        disconnect_event = asyncio.Event()
        call_started = asyncio.Event()
        request = _FakeDisconnectRequest(disconnect_event)

        async def call() -> object:
            call_started.set()
            return await fake.complete(_MESSAGES, model="m")

        # Deterministic: flips the disconnect flag only once the wrapped
        # call has provably started, via an event — never a fixed-duration
        # sleep racing against `run_cancellable`'s own poll loop.
        async def disconnect_once_started() -> None:
            await call_started.wait()
            disconnect_event.set()

        asyncio.ensure_future(disconnect_once_started())

        with pytest.raises(LLMUnavailableError):
            await run_cancellable(request, call())

    _run(scenario)

    captured = capsys.readouterr().out
    _assert_no_sentinel_leaked(captured, caplog.records)
    assert fake.cancelled_calls == 1
