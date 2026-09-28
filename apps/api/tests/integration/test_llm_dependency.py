"""Integration tests for `ai.deps.get_llm_client`'s lifespan wiring, its
overridability, and the registered `LLMUnavailableError` -> `503` handler
(issue #37).

No test here makes a real network call: the one test that touches the real
`HttpLLMClient` the lifespan builds (`test_get_llm_client_is_bound_to_a...`)
never sends a request through it, only checks identity/close state, and
`_forbid_real_network` (autouse below) would fail loudly if any test in
this file ever fell through to the real transport.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Annotated

import httpx
import pytest
from conftest import make_client
from fastapi import Depends, FastAPI
from httpx import Response

from planora_api.ai.client import (
    HttpLLMClient,
    LLMClient,
    LLMCompletion,
    LLMUnavailableError,
)
from planora_api.ai.deps import get_llm_client
from planora_api.ai.fake import FakeLLMClient


@pytest.fixture(autouse=True)
def _llm_base_url_is_never_real(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_BASE_URL", "https://llm.invalid/v1")


@pytest.fixture(autouse=True)
def _forbid_real_network(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _blow_up(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("real network transport must never be exercised in tests")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _blow_up)


def _run(coro_fn: Callable[[], Awaitable[object]]) -> object:
    return asyncio.run(coro_fn())


def test_get_llm_client_is_bound_to_a_lifespan_managed_client_closed_on_shutdown(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()

    async def scenario() -> httpx.AsyncClient:
        async with app.router.lifespan_context(app):
            client = app.state.llm_client
            assert isinstance(client, HttpLLMClient)
            underlying = client.http_client
            assert isinstance(underlying, httpx.AsyncClient)
            assert not underlying.is_closed
        return underlying

    underlying = _run(scenario)
    assert underlying.is_closed


def test_get_llm_client_returns_the_lifespan_bound_client(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    """Calls the real `get_llm_client` function (not through an override,
    unlike every other test below) to prove it actually returns
    `request.app.state.llm_client`. The route never calls `.complete()`,
    so no request — real or mocked — is ever sent."""
    app = app_factory()

    @app.get("/api/v1/__test_only/whoami")
    async def whoami(client: Annotated[LLMClient, Depends(get_llm_client)]) -> dict[str, bool]:
        return {"is_http_client": isinstance(client, HttpLLMClient)}

    async def scenario() -> Response:
        async with app.router.lifespan_context(app), make_client(app) as http:
            return await http.get("/api/v1/__test_only/whoami")

    response = _run(scenario)
    assert response.status_code == 200
    assert response.json() == {"is_http_client": True}


def test_get_llm_client_is_overridable_and_the_default_is_never_exercised(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()
    completion = LLMCompletion(content="stub", tool_calls=(), finish_reason="stop", usage=None)
    fake = FakeLLMClient([completion])
    app.dependency_overrides[get_llm_client] = lambda: fake

    @app.post("/api/v1/__test_only/ask")
    async def ask(client: Annotated[LLMClient, Depends(get_llm_client)]) -> dict[str, str | None]:
        result = await client.complete([{"role": "user", "content": "hi"}], model="m")
        return {"content": result.content}

    async def scenario() -> Response:
        async with make_client(app) as http:
            return await http.post("/api/v1/__test_only/ask")

    response = _run(scenario)
    assert response.status_code == 200
    assert response.json() == {"content": "stub"}
    assert len(fake.calls) == 1


def test_llm_unavailable_error_becomes_503_ai_unavailable(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    app = app_factory()
    fake = FakeLLMClient([LLMUnavailableError("http_status", status=500)])
    app.dependency_overrides[get_llm_client] = lambda: fake

    @app.post("/api/v1/__test_only/ask")
    async def ask(client: Annotated[LLMClient, Depends(get_llm_client)]) -> None:
        await client.complete([{"role": "user", "content": "hi"}], model="m")

    async def scenario() -> Response:
        async with make_client(app) as http:
            return await http.post("/api/v1/__test_only/ask")

    response = _run(scenario)
    assert response.status_code == 503
    assert response.json() == {
        "code": "AI_UNAVAILABLE",
        "message": "The assistant is unavailable right now. Try again.",
    }


def test_every_reason_maps_to_the_same_503_envelope(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    for reason in ("timeout", "connect_error", "http_status", "invalid_response", "cancelled"):
        app = app_factory()
        fake = FakeLLMClient([LLMUnavailableError(reason)])  # type: ignore[arg-type]
        app.dependency_overrides[get_llm_client] = lambda fake=fake: fake

        @app.post("/api/v1/__test_only/ask")
        async def ask(client: Annotated[LLMClient, Depends(get_llm_client)]) -> None:
            await client.complete([{"role": "user", "content": "hi"}], model="m")

        async def scenario(app: FastAPI = app) -> Response:
            async with make_client(app) as http:
                return await http.post("/api/v1/__test_only/ask")

        response = _run(scenario)
        assert response.status_code == 503, reason
        assert response.json()["code"] == "AI_UNAVAILABLE", reason
