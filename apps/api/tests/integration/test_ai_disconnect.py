"""A client that disconnects mid-request is a request that never happened
(issue #123, spec §15.2).

These drive the full `create_app()` ASGI stack (CSRF and `request_logging`
middleware included) with a hand-written ASGI `receive` that delivers the
whole request body and then a real `http.disconnect` when the test says so.
`httpx.ASGITransport` cannot do that — it only reports a disconnect once
the response is complete — and the failure being pinned (a middleware that
wraps `receive` hides the disconnect from `Request.is_disconnected()`) only
shows through the real stack, never through a monkeypatched
`is_disconnected` (see the older cancellation tests in
`test_chat_messages.py` and `test_ai_parse_task.py`).

`_POLL_INTERVAL` is deliberately left at its production value: the
acceptance bound is two seconds with the real poll interval.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from conftest import DEFAULT_ORIGIN, make_client, valid_access_token
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from starlette.types import Message

from planora_api.ai.client import LLMCompletion, LLMToolCall
from planora_api.ai.deps import get_llm_client
from planora_api.ai.fake import BLOCK, FakeLLMClient
from planora_api.api.deps import get_current_time
from planora_api.db.models import ChatAction, ChatMessage, Task

MESSAGES_URL = "/api/v1/chat/messages"
CONVERSATION_URL = "/api/v1/chat/conversation"
PARSE_URL = "/api/v1/ai/parse-task"
NOW = datetime(2026, 10, 3, 12, 0, 0, tzinfo=UTC)
CANCEL_DEADLINE_SECONDS = 2.0


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


@dataclass
class _Exchange:
    """What one raw ASGI call produced."""

    messages: list[Message] = field(default_factory=list)
    finished: bool = False
    elapsed_after_disconnect: float | None = None

    @property
    def status(self) -> int | None:
        for message in self.messages:
            if message["type"] == "http.response.start":
                return message["status"]
        return None


class _Wire:
    """One in-flight ASGI HTTP request whose disconnect the test controls.

    `receive` hands over the complete body (one `http.request`, no more
    body) and then waits — exactly what uvicorn does after the request is
    read — until `disconnect()` is called, after which it reports
    `http.disconnect` on every call.
    """

    def __init__(self, app: FastAPI, path: str, payload: Mapping[str, Any]) -> None:
        body = json.dumps(payload).encode()
        self._body_sent = False
        self._body = body
        self._disconnected = asyncio.Event()
        self._disconnect_at: float | None = None
        self.exchange = _Exchange()
        self.scope: dict[str, Any] = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": path,
            "raw_path": path.encode(),
            "root_path": "",
            "query_string": b"",
            "server": ("test", 443),
            "client": ("127.0.0.1", 50000),
            "headers": [
                (b"host", b"test"),
                (b"origin", DEFAULT_ORIGIN.encode()),
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"x-planora-profile", b"hamster_knight"),
                (b"cookie", f"planora_access={valid_access_token(app)}".encode()),
            ],
            "state": {},
        }
        self._app = app
        self.task: asyncio.Task[None] | None = None

    async def _receive(self) -> Message:
        if not self._body_sent:
            self._body_sent = True
            return {"type": "http.request", "body": self._body, "more_body": False}
        await self._disconnected.wait()
        return {"type": "http.disconnect"}

    async def _send(self, message: Message) -> None:
        self.exchange.messages.append(message)

    def start(self) -> None:
        async def call() -> None:
            await self._app(self.scope, self._receive, self._send)
            self.exchange.finished = True
            if self._disconnect_at is not None:
                self.exchange.elapsed_after_disconnect = time.perf_counter() - self._disconnect_at

        self.task = asyncio.ensure_future(call())

    def disconnect(self) -> None:
        self._disconnect_at = time.perf_counter()
        self._disconnected.set()

    async def finish(self, timeout: float = CANCEL_DEADLINE_SECONDS) -> _Exchange:
        assert self.task is not None
        await asyncio.wait({self.task}, timeout=timeout)
        if not self.task.done():
            self.task.cancel()
            raise AssertionError(f"request still running {timeout}s after the disconnect")
        self.task.result()
        return self.exchange


async def _wait_until(predicate: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.perf_counter() + timeout
    while not predicate():
        assert time.perf_counter() < deadline, "condition never became true"
        await asyncio.sleep(0.005)


def _text(content: str) -> LLMCompletion:
    return LLMCompletion(content=content, tool_calls=(), finish_reason="stop", usage=None)


def _propose_create_task() -> LLMCompletion:
    arguments = {"title": "Book dentist", "content": "Call", "category": "personal", "priority": "high"}
    return LLMCompletion(
        content=None,
        tool_calls=(
            LLMToolCall(
                id="call_0", name="propose_create_task", arguments_json=json.dumps(arguments)
            ),
        ),
        finish_reason="tool_calls",
        usage=None,
    )


class _DisconnectsOnFinalAnswer(FakeLLMClient):
    """Scripted like `FakeLLMClient`, but the client goes away at the
    moment the provider returns its last scripted step — after the provider
    work, before the route has saved anything."""

    def __init__(self, script: Sequence[Any], wire: Callable[[], _Wire]) -> None:
        super().__init__(script)
        self._wire = wire

    async def complete(self, *args: Any, **kwargs: Any) -> LLMCompletion:
        completion = await super().complete(*args, **kwargs)
        if not self._script:
            self._wire().disconnect()
        return completion


def _wire_llm(app: FastAPI, fake: FakeLLMClient) -> None:
    app.dependency_overrides[get_llm_client] = lambda: fake
    app.dependency_overrides[get_current_time] = lambda: NOW


def _persisted(session_factory: sessionmaker[Session]) -> tuple[int, int, int]:
    with session_factory() as session:
        return (
            len(session.execute(select(ChatMessage)).scalars().all()),
            len(session.execute(select(ChatAction)).scalars().all()),
            len(session.execute(select(Task)).scalars().all()),
        )


async def _conversation_messages(app: FastAPI) -> list[Any]:
    async with make_client(app) as client:
        client.headers["X-Planora-Profile"] = "hamster_knight"
        response = await client.get(CONVERSATION_URL)
    assert response.status_code == 200
    return response.json()["messages"]


def test_chat_disconnect_while_the_provider_is_pending_cancels_it_and_saves_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    fake = FakeLLMClient([BLOCK])
    _wire_llm(app, fake)

    async def scenario() -> _Exchange:
        wire = _Wire(app, MESSAGES_URL, {"text": "Fixture chat 3"})
        wire.start()
        await _wait_until(lambda: len(fake.calls) == 1)
        wire.disconnect()
        exchange = await wire.finish()
        assert await _conversation_messages(app) == []
        return exchange

    exchange = _run(scenario)

    assert fake.cancelled_calls == 1
    assert exchange.elapsed_after_disconnect is not None
    assert exchange.elapsed_after_disconnect < CANCEL_DEADLINE_SECONDS
    assert _persisted(migrated_session_factory) == (0, 0, 0)


def test_chat_disconnect_after_the_provider_returned_but_before_the_save_saves_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    wires: list[_Wire] = []
    fake = _DisconnectsOnFinalAnswer(
        [_propose_create_task(), _text("I proposed a task.")], lambda: wires[0]
    )
    _wire_llm(app, fake)

    async def scenario() -> None:
        wire = _Wire(app, MESSAGES_URL, {"text": "Book the dentist"})
        wires.append(wire)
        wire.start()
        await wire.finish()
        assert await _conversation_messages(app) == []

    _run(scenario)

    assert len(fake.calls) == 2  # the provider really did finish its turn
    assert _persisted(migrated_session_factory) == (0, 0, 0)


def test_chat_that_stays_connected_still_saves_the_turn(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    fake = FakeLLMClient([_propose_create_task(), _text("I proposed a task.")])
    _wire_llm(app, fake)

    async def scenario() -> _Exchange:
        wire = _Wire(app, MESSAGES_URL, {"text": "Book the dentist"})
        wire.start()
        return await wire.finish()

    exchange = _run(scenario)

    assert exchange.status == 200
    messages, actions, tasks = _persisted(migrated_session_factory)
    assert (messages, actions, tasks) == (2, 1, 0)


def test_parse_task_disconnect_cancels_the_provider_call_within_two_seconds(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    fake = FakeLLMClient([BLOCK])
    _wire_llm(app, fake)

    async def scenario() -> _Exchange:
        wire = _Wire(app, PARSE_URL, {"text": "buy milk tomorrow"})
        wire.start()
        await _wait_until(lambda: len(fake.calls) == 1)
        wire.disconnect()
        return await wire.finish()

    exchange = _run(scenario)

    assert fake.cancelled_calls == 1
    assert exchange.elapsed_after_disconnect is not None
    assert exchange.elapsed_after_disconnect < CANCEL_DEADLINE_SECONDS
    assert _persisted(migrated_session_factory) == (0, 0, 0)
