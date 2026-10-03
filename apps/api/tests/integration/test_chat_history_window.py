"""Issue #121: no DB transaction spans an LLM call, and the LLM history is
a bounded window of the last 20 messages (response body unchanged)."""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from conftest import make_client
from fastapi import FastAPI
from httpx import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.ai.client import LLMCompletion, LLMToolCall, LLMUnavailableError
from planora_api.ai.deps import get_llm_client
from planora_api.ai.fake import FakeLLMClient
from planora_api.api.deps import get_current_time
from planora_api.db import chat_action_repository, chat_repository
from planora_api.db.models import ChatAction, ChatActionKind, ChatMessage, ChatRole
from planora_api.domain.chat_actions import ActionField

MESSAGES_URL = "/api/v1/chat/messages"
NOW = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)


def _text(text: str) -> LLMCompletion:
    return LLMCompletion(content=text, tool_calls=(), finish_reason="stop", usage=None)


def _tool(name: str, args: dict[str, Any]) -> LLMCompletion:
    return LLMCompletion(
        content=None,
        tool_calls=(LLMToolCall(id="call_0", name=name, arguments_json=json.dumps(args)),),
        finish_reason="tool_calls",
        usage=None,
    )


class TxCheckingFake(FakeLLMClient):
    """Records `in_transaction()` of every session the app opened, at each
    `complete()` call."""

    def __init__(self, script: list[Any], sessions: list[Session]) -> None:
        super().__init__(script)
        self._sessions = sessions
        self.open_at_call: list[bool] = []

    async def complete(self, *args: Any, **kwargs: Any) -> LLMCompletion:
        self.open_at_call.append(any(s.in_transaction() for s in self._sessions))
        return await super().complete(*args, **kwargs)


def _track_sessions(app: FastAPI) -> list[Session]:
    sessions: list[Session] = []
    original = app.state.session_factory

    def factory() -> Session:
        session = original()
        sessions.append(session)
        return session

    factory.kw = original.kw  # type: ignore[attr-defined]  # app_factory teardown disposes it
    app.state.session_factory = factory
    return sessions


def _wire(app: FastAPI, fake: FakeLLMClient) -> None:
    app.dependency_overrides[get_llm_client] = lambda: fake
    app.dependency_overrides[get_current_time] = lambda: NOW


def _seed_messages(
    factory: sessionmaker[Session], count: int, profile: int = 1
) -> list[uuid.UUID]:
    ids: list[uuid.UUID] = []
    with factory() as db:
        db.info["profile_id"] = profile
        for i in range(1, count + 1):
            role = ChatRole.USER if i % 2 else ChatRole.ASSISTANT
            ids.append(chat_repository.append_message(db, role=role, text=f"m{i}", now=NOW).id)
        db.commit()
    return ids


def _seed_action(factory: sessionmaker[Session], message_id: uuid.UUID, profile: int = 1) -> None:
    with factory() as db:
        db.info["profile_id"] = profile
        chat_action_repository.create_action(
            db,
            message_id=message_id,
            kind=ChatActionKind.CREATE,
            title="T",
            summary="Create thing",
            fields=[ActionField(label="Title", from_value=None, to_value="x")],
            payload={"title": "x"},
            task_id=None,
            stale_snapshot={},
            changed_fields=None,
            now=NOW,
        )
        db.commit()


def _post(app: FastAPI, profile: str, text: str) -> Response:
    async def scenario() -> Response:
        async with make_client(app) as client:
            client.headers["X-Planora-Profile"] = profile
            return await client.post(MESSAGES_URL, json={"text": text})

    return asyncio.run(scenario())


def _count(factory: sessionmaker[Session], model: Any, profile: int = 1) -> int:
    with factory() as db:
        return db.execute(
            select(func.count()).select_from(model).where(model.profile_id == profile)
        ).scalar_one()


def test_no_transaction_open_at_any_complete_including_after_read_tool(
    valid_env: Any,
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_messages(migrated_session_factory, 3)
    app = app_factory()
    sessions = _track_sessions(app)
    fake = TxCheckingFake(
        [_tool("find_active_tasks", {}), _text("Nothing overdue.")], sessions
    )
    _wire(app, fake)

    response = _post(app, "hamster_knight", "What is overdue?")

    assert response.status_code == 200
    assert fake.open_at_call == [False, False]
    assert len(response.json()["messages"]) == 5


def test_llm_failure_after_tool_call_writes_nothing(
    valid_env: Any,
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_messages(migrated_session_factory, 3)
    app = app_factory()
    sessions = _track_sessions(app)
    fake = TxCheckingFake(
        [_tool("find_active_tasks", {}), LLMUnavailableError("timeout")], sessions
    )
    _wire(app, fake)

    response = _post(app, "hamster_knight", "What is overdue?")

    assert response.status_code == 503
    assert response.json()["code"] == "AI_UNAVAILABLE"
    assert fake.open_at_call == [False, False]
    assert _count(migrated_session_factory, ChatMessage) == 3
    assert _count(migrated_session_factory, ChatAction) == 0


def test_long_conversation_sends_last_20_with_annotation_and_full_response(
    valid_env: Any,
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    ids = _seed_messages(migrated_session_factory, 25, profile=2)
    _seed_action(migrated_session_factory, ids[21], profile=2)  # message 22
    _seed_action(migrated_session_factory, ids[1], profile=2)  # message 2, outside window
    app = app_factory()
    fake = FakeLLMClient([_text("ok")])
    _wire(app, fake)

    response = _post(app, "ech_princess", "Next?")

    assert response.status_code == 200
    sent = fake.calls[0].messages
    assert sent[0]["role"] == "system"
    assert [m["content"].split("\n")[0] for m in sent[1:-1]] == [f"m{i}" for i in range(6, 26)]
    assert sent[-1] == {"role": "user", "content": "Next?"}
    assert "[Proposed create: Create thing (status: pending)]" in sent[1 + (22 - 6)]["content"]
    body = response.json()["messages"]
    assert len(body) == 27
    assert all("action" in m for m in body)
    assert body[1]["action"] is not None and body[21]["action"] is not None


def test_short_conversation_sends_whole_history(
    valid_env: Any,
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_messages(migrated_session_factory, 4, profile=2)
    app = app_factory()
    fake = FakeLLMClient([_text("ok")])
    _wire(app, fake)

    assert _post(app, "ech_princess", "Hi").status_code == 200

    sent = fake.calls[0].messages
    assert [m["content"] for m in sent[1:-1]] == ["m1", "m2", "m3", "m4"]


def test_history_repository_reads_only_the_window(
    valid_env: Any, migrated_session_factory: sessionmaker[Session]
) -> None:
    ids = _seed_messages(migrated_session_factory, 25)
    _seed_action(migrated_session_factory, ids[1])  # message 2
    _seed_action(migrated_session_factory, ids[21])  # message 22
    with migrated_session_factory() as db:
        messages = chat_repository.list_recent_messages(db, limit=20)
        actions = chat_action_repository.list_actions_for_messages(db, [m.id for m in messages])
    assert [m.text for m in messages] == [f"m{i}" for i in range(6, 26)]
    assert set(actions) == {ids[21]}
    with migrated_session_factory() as db:
        assert chat_action_repository.list_actions_for_messages(db, []) == {}
