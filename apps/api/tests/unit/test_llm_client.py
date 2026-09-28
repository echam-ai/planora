"""Unit tests for `ai.client.HttpLLMClient` (issue #37, spec §10.4).

Every test drives the client through `httpx.MockTransport` — no real
network call is ever made. `_forbid_real_network` below is a second,
independent guard: even if a bug in a test accidentally built a client
with the real default transport, the guard raises loudly instead of
letting a socket connection attempt slip through.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable

import httpx
import pytest
from pydantic import ValidationError

from planora_api.ai.client import (
    SAFE_MESSAGE,
    TIMEOUT,
    HttpLLMClient,
    LLMCompletion,
    LLMUnavailableError,
)

BASE_URL = "https://llm.invalid/v1"
API_KEY = "SENTINEL-test-api-key"


@pytest.fixture(autouse=True)
def _forbid_real_network(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _blow_up(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("real network transport must never be exercised in tests")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _blow_up)


def _run(coro_fn: Callable[[], Awaitable[object]]) -> object:
    return asyncio.run(coro_fn())


def _client(handler: Callable[[httpx.Request], httpx.Response], *, base_url: str = BASE_URL) -> tuple[HttpLLMClient, httpx.AsyncClient]:
    http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return HttpLLMClient(http_client, base_url=base_url, api_key=API_KEY), http_client


_SUCCESS_BODY = {
    "choices": [{"message": {"content": "Hello"}, "finish_reason": "stop"}],
    "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15},
}


def test_success_sends_the_exact_request_and_parses_the_completion(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(200, json=_SUCCESS_BODY)

    client, http_client = _client(handler)

    async def scenario() -> LLMCompletion:
        try:
            return await client.complete(
                [{"role": "user", "content": "Hi"}], model="kimi-k3-turbo"
            )
        finally:
            await http_client.aclose()

    completion = _run(scenario)

    request = seen["request"]
    assert request.method == "POST"
    assert str(request.url) == "https://llm.invalid/v1/chat/completions"
    assert request.headers["authorization"] == f"Bearer {API_KEY}"
    body = json.loads(request.content)
    assert body == {
        "model": "kimi-k3-turbo",
        "messages": [{"role": "user", "content": "Hi"}],
    }
    assert request.extensions.get("timeout") == {
        "connect": 5.0,
        "read": 60.0,
        "write": 60.0,
        "pool": 60.0,
    }
    assert TIMEOUT.connect == 5.0
    assert TIMEOUT.read == 60.0

    assert completion.content == "Hello"
    assert completion.tool_calls == ()
    assert completion.finish_reason == "stop"
    assert completion.usage is not None
    assert completion.usage.prompt_tokens == 12
    assert completion.usage.completion_tokens == 3
    assert completion.usage.total_tokens == 15

    completed_records = [r for r in caplog.records if r.getMessage() == "llm_request_completed"]
    assert len(completed_records) == 1
    record = completed_records[0]
    assert record.levelno == logging.INFO
    assert record.model == "kimi-k3-turbo"
    assert record.status == 200
    assert isinstance(record.duration_ms, (int, float))
    # No message text anywhere on the record.
    assert not hasattr(record, "content")
    assert not hasattr(record, "messages")


def test_trailing_slash_on_base_url_is_tolerated() -> None:
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(200, json=_SUCCESS_BODY)

    client, http_client = _client(handler, base_url="https://llm.invalid/v1/")

    async def scenario() -> None:
        try:
            await client.complete([{"role": "user", "content": "Hi"}], model="m")
        finally:
            await http_client.aclose()

    _run(scenario)
    url = str(seen["request"].url)
    assert url == "https://llm.invalid/v1/chat/completions"
    assert "//chat" not in url


def test_response_format_tools_and_tool_choice_pass_through_when_given() -> None:
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(200, json=_SUCCESS_BODY)

    client, http_client = _client(handler)
    response_format = {"type": "json_object"}
    tools = [{"type": "function", "function": {"name": "do_thing"}}]
    tool_choice = "auto"

    async def scenario() -> None:
        try:
            await client.complete(
                [{"role": "user", "content": "Hi"}],
                model="m",
                response_format=response_format,
                tools=tools,
                tool_choice=tool_choice,
            )
        finally:
            await http_client.aclose()

    _run(scenario)
    body = json.loads(seen["request"].content)
    assert body["response_format"] == response_format
    assert body["tools"] == tools
    assert body["tool_choice"] == tool_choice


def test_response_format_tools_and_tool_choice_omitted_when_none() -> None:
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(200, json=_SUCCESS_BODY)

    client, http_client = _client(handler)

    async def scenario() -> None:
        try:
            await client.complete([{"role": "user", "content": "Hi"}], model="m")
        finally:
            await http_client.aclose()

    _run(scenario)
    body = json.loads(seen["request"].content)
    assert "response_format" not in body
    assert "tools" not in body
    assert "tool_choice" not in body


def test_tool_calls_are_parsed_with_raw_unparsed_arguments() -> None:
    body = {
        "choices": [
            {
                "message": {
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "move_task", "arguments": '{"id": "abc"}'},
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ]
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    client, http_client = _client(handler)

    async def scenario() -> LLMCompletion:
        try:
            return await client.complete([{"role": "user", "content": "Hi"}], model="m")
        finally:
            await http_client.aclose()

    completion = _run(scenario)
    assert completion.content is None
    assert len(completion.tool_calls) == 1
    call = completion.tool_calls[0]
    assert call.id == "call_1"
    assert call.name == "move_task"
    assert call.arguments_json == '{"id": "abc"}'
    assert completion.usage is None


def test_timeout_raises_llm_unavailable_error_with_no_chained_exception(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    client, http_client = _client(handler)

    async def scenario() -> LLMUnavailableError:
        try:
            with pytest.raises(LLMUnavailableError) as exc_info:
                await client.complete([{"role": "user", "content": "Hi"}], model="m")
            return exc_info.value
        finally:
            await http_client.aclose()

    exc = _run(scenario)
    assert exc.reason == "timeout"
    assert exc.status is None
    assert str(exc) == SAFE_MESSAGE
    assert exc.__cause__ is None
    assert exc.__suppress_context__ is True

    failed_records = [r for r in caplog.records if r.getMessage() == "llm_request_failed"]
    assert len(failed_records) == 1
    assert failed_records[0].levelno == logging.ERROR
    assert failed_records[0].reason == "timeout"
    assert failed_records[0].status is None


def test_connect_error_raises_llm_unavailable_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client, http_client = _client(handler)

    async def scenario() -> LLMUnavailableError:
        try:
            with pytest.raises(LLMUnavailableError) as exc_info:
                await client.complete([{"role": "user", "content": "Hi"}], model="m")
            return exc_info.value
        finally:
            await http_client.aclose()

    exc = _run(scenario)
    assert exc.reason == "connect_error"
    assert exc.status is None
    assert str(exc) == SAFE_MESSAGE


@pytest.mark.parametrize("status", [500, 401, 403])
def test_http_status_errors_raise_llm_unavailable_error_with_status(
    status: int, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    sentinel = "SENTINEL-provider-error-body"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": sentinel})

    client, http_client = _client(handler)

    async def scenario() -> LLMUnavailableError:
        try:
            with pytest.raises(LLMUnavailableError) as exc_info:
                await client.complete([{"role": "user", "content": "Hi"}], model="m")
            return exc_info.value
        finally:
            await http_client.aclose()

    exc = _run(scenario)
    assert exc.reason == "http_status"
    assert exc.status == status
    assert str(exc) == SAFE_MESSAGE

    failed_records = [r for r in caplog.records if r.getMessage() == "llm_request_failed"]
    assert len(failed_records) == 1
    assert failed_records[0].reason == "http_status"
    assert failed_records[0].status == status
    assert sentinel not in caplog.text


def test_non_json_body_raises_invalid_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"not json")

    client, http_client = _client(handler)

    async def scenario() -> LLMUnavailableError:
        try:
            with pytest.raises(LLMUnavailableError) as exc_info:
                await client.complete([{"role": "user", "content": "Hi"}], model="m")
            return exc_info.value
        finally:
            await http_client.aclose()

    exc = _run(scenario)
    assert exc.reason == "invalid_response"
    assert str(exc) == SAFE_MESSAGE


def test_missing_choices_raises_invalid_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": []})

    client, http_client = _client(handler)

    async def scenario() -> LLMUnavailableError:
        try:
            with pytest.raises(LLMUnavailableError) as exc_info:
                await client.complete([{"role": "user", "content": "Hi"}], model="m")
            return exc_info.value
        finally:
            await http_client.aclose()

    exc = _run(scenario)
    assert exc.reason == "invalid_response"


def test_wrong_types_in_message_raises_invalid_response_not_validation_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"choices": [{"message": {"content": 12345}, "finish_reason": "stop"}]}
        )

    client, http_client = _client(handler)

    async def scenario() -> LLMUnavailableError:
        try:
            with pytest.raises(LLMUnavailableError) as exc_info:
                await client.complete([{"role": "user", "content": "Hi"}], model="m")
            return exc_info.value
        finally:
            await http_client.aclose()

    exc = _run(scenario)
    assert exc.reason == "invalid_response"
    # Never a raw pydantic/KeyError leaking out of `complete()`.
    assert not isinstance(exc, (ValidationError, KeyError))


def test_missing_message_key_raises_invalid_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop"}]})

    client, http_client = _client(handler)

    async def scenario() -> LLMUnavailableError:
        try:
            with pytest.raises(LLMUnavailableError) as exc_info:
                await client.complete([{"role": "user", "content": "Hi"}], model="m")
            return exc_info.value
        finally:
            await http_client.aclose()

    exc = _run(scenario)
    assert exc.reason == "invalid_response"
