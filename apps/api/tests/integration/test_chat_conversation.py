"""Integration tests for `/api/v1/chat/conversation` (issue #39, spec
§10.3, §13.1, §15.5).

Follows the pattern in `tests/integration/test_tasks_crud.py` and
`tests/integration/test_archive.py`: an HTTPX `AsyncClient` against the real
ASGI app, `migrated_session_factory` for a disposable SQLite database,
`app_factory()` for a fresh app per test, and `make_client` sending the
configured `APP_ORIGIN` by default so only the CSRF-focused tests need to
override it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import make_client
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session, sessionmaker

from planora_api.db import chat_repository
from planora_api.db.models import (
    ChatMessage,
    ChatRole,
    Conversation,
    Task,
    TaskCategory,
    TaskPriority,
    TaskStatus,
)

CONVERSATION_URL = "/api/v1/chat/conversation"
TASKS_URL = "/api/v1/tasks"
ARCHIVE_URL = "/api/v1/archive"
FOREIGN_ORIGIN = "https://evil.example"


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _select_profile(client: AsyncClient) -> None:
    client.headers["X-Planora-Profile"] = "hamster_knight"


def _seed_task(
    session_factory: sessionmaker[Session], **overrides: Any
) -> uuid.UUID:
    defaults: dict[str, Any] = {
        "title": "Task",
        "content": "Content",
        "status": TaskStatus.TODO,
        "category": TaskCategory.WORK,
        "priority": TaskPriority.MEDIUM,
        "position": 1.0,
    }
    defaults.update(overrides)
    with session_factory() as session:
        task = Task(**defaults)
        session.add(task)
        session.commit()
        return task.id


def _snapshot_task(session_factory: sessionmaker[Session], task_id: uuid.UUID) -> dict[str, Any]:
    with session_factory() as session:
        task = session.get(Task, task_id)
        assert task is not None
        return {
            "title": task.title,
            "content": task.content,
            "status": task.status,
            "category": task.category,
            "priority": task.priority,
            "deadline_at": task.deadline_at,
            "urls": task.urls,
            "markdown_note": task.markdown_note,
            "position": task.position,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
            "completed_at": task.completed_at,
            "archived_at": task.archived_at,
        }


def _seed_messages(
    session_factory: sessionmaker[Session], *, shared_created_at: datetime
) -> None:
    """Append three messages directly through the repository — user,
    assistant, user — with the first two sharing an identical
    `created_at`."""
    with session_factory() as session:
        chat_repository.append_message(
            session, role=ChatRole.USER, text="first", now=shared_created_at
        )
        chat_repository.append_message(
            session, role=ChatRole.ASSISTANT, text="second", now=shared_created_at
        )
        chat_repository.append_message(
            session,
            role=ChatRole.USER,
            text="third",
            now=shared_created_at + timedelta(minutes=1),
        )
        session.commit()


def _all_conversations(session_factory: sessionmaker[Session]) -> list[Conversation]:
    with session_factory() as session:
        return list(session.execute(select(Conversation)).scalars().all())


def _all_messages(session_factory: sessionmaker[Session]) -> list[ChatMessage]:
    with session_factory() as session:
        return list(session.execute(select(ChatMessage)).scalars().all())


# --- GET: lazy creation, stability, ordering --------------------------------


def test_get_on_empty_database_lazily_creates_one_empty_conversation(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.get(CONVERSATION_URL)

    response = _run(scenario)

    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"id", "messages"}
    assert uuid.UUID(body["id"])
    assert body["messages"] == []
    assert len(_all_conversations(migrated_session_factory)) == 1


def test_two_consecutive_gets_return_the_same_id_and_one_row(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            first = await client.get(CONVERSATION_URL)
            second = await client.get(CONVERSATION_URL)
            return first, second

    first, second = _run(scenario)

    assert first.json()["id"] == second.json()["id"]
    assert len(_all_conversations(migrated_session_factory)) == 1


def test_messages_come_back_in_append_order_including_a_shared_created_at(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    shared = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)
    _seed_messages(migrated_session_factory, shared_created_at=shared)
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.get(CONVERSATION_URL)

    response = _run(scenario)

    assert response.status_code == 200
    messages = response.json()["messages"]
    assert [m["text"] for m in messages] == ["first", "second", "third"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user"]
    for message in messages:
        assert set(message.keys()) == {"id", "role", "text", "created_at", "action"}
        assert uuid.UUID(message["id"])
        # ISO 8601 UTC, same format as task timestamps.
        datetime.fromisoformat(message["created_at"])


# --- POST (reset) ------------------------------------------------------------


def test_reset_returns_201_with_a_new_id_and_no_messages(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    shared = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)
    _seed_messages(migrated_session_factory, shared_created_at=shared)
    app = app_factory()

    async def scenario() -> tuple[str, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            before = await client.get(CONVERSATION_URL)
            reset_response = await client.post(CONVERSATION_URL)
            return before.json()["id"], reset_response

    previous_id, reset_response = _run(scenario)

    assert reset_response.status_code == 201
    body = reset_response.json()
    assert body["id"] != previous_id
    assert body["messages"] == []
    assert _all_messages(migrated_session_factory) == []
    assert len(_all_conversations(migrated_session_factory)) == 1


def test_reset_is_visible_to_a_second_authenticated_client(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    shared = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)
    _seed_messages(migrated_session_factory, shared_created_at=shared)
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as first_client:
            await _select_profile(first_client)
            reset_response = await first_client.post(CONVERSATION_URL)

        async with make_client(app) as second_client:
            await _select_profile(second_client)
            get_response = await second_client.get(CONVERSATION_URL)

        return reset_response, get_response

    reset_response, get_response = _run(scenario)

    assert reset_response.json()["id"] == get_response.json()["id"]
    assert get_response.json()["messages"] == []


def test_reset_leaves_active_and_archived_task_rows_field_for_field_identical(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    now = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)
    active_id = _seed_task(migrated_session_factory, title="Active", updated_at=now)
    archived_id = _seed_task(
        migrated_session_factory,
        title="Archived",
        status=TaskStatus.DONE,
        completed_at=now,
        archived_at=now + timedelta(days=7),
        updated_at=now,
    )
    _seed_messages(migrated_session_factory, shared_created_at=now)

    before_active = _snapshot_task(migrated_session_factory, active_id)
    before_archived = _snapshot_task(migrated_session_factory, archived_id)

    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(CONVERSATION_URL)

    reset_response = _run(scenario)

    assert reset_response.status_code == 201
    assert _snapshot_task(migrated_session_factory, active_id) == before_active
    assert _snapshot_task(migrated_session_factory, archived_id) == before_archived


# --- Single-conversation invariant, enforced by the schema ------------------


def test_inserting_a_unknown_profile_conversation_row_raises_an_integrity_error(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    with migrated_session_factory() as session:
        chat_repository.get_or_create_conversation(session, now=datetime.now(UTC))
        session.commit()

    with migrated_session_factory() as session:
        session.add(
            Conversation(id=3, conversation_id=uuid.uuid4(), created_at=datetime.now(UTC), updated_at=datetime.now(UTC))
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

    assert len(_all_conversations(migrated_session_factory)) == 1


def test_invalid_role_is_rejected_at_the_database_layer(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    with migrated_session_factory() as session:
        session.add(
            ChatMessage(
                id=uuid.uuid4(),
                sequence=1,
                role="system",
                text="not allowed",
                created_at=datetime.now(UTC),
            )
        )
        with pytest.raises(StatementError):
            session.commit()
        session.rollback()

    assert _all_messages(migrated_session_factory) == []


# --- Auth and CSRF -----------------------------------------------------------


def test_get_without_session_returns_422(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.get(CONVERSATION_URL)

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_post_without_session_returns_422(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.post(CONVERSATION_URL)

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_post_with_mismatched_origin_returns_403_and_writes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    shared = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)
    _seed_messages(migrated_session_factory, shared_created_at=shared)
    app = app_factory()

    async def scenario() -> tuple[str, Response]:
        async with make_client(app) as login_client:
            await _select_profile(login_client)
            cookies = dict(login_client.cookies)
            before = await login_client.get(CONVERSATION_URL)

        async with make_client(app, origin=FOREIGN_ORIGIN) as client:
            client.cookies.update(cookies)
            forbidden = await client.post(CONVERSATION_URL)
        return before.json()["id"], forbidden

    previous_id, forbidden = _run(scenario)

    assert forbidden.status_code == 403
    assert forbidden.json()["code"] == "CSRF_ORIGIN_MISMATCH"

    with migrated_session_factory() as session:
        conversation = session.get(Conversation, 1)
        assert conversation is not None
        assert str(conversation.conversation_id) == previous_id
    assert len(_all_messages(migrated_session_factory)) == 3


# --- Logging redaction (spec §15.5) -----------------------------------------


def test_message_text_never_appears_in_logs_from_get_or_reset(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    valid_env.setenv("LOG_LEVEL", "DEBUG")
    sentinel = "SENTINEL-chat-message-text"
    now = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)
    with migrated_session_factory() as session:
        chat_repository.append_message(session, role=ChatRole.USER, text=sentinel, now=now)
        session.commit()

    app = app_factory()
    caplog.set_level(logging.DEBUG)

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            get_response = await client.get(CONVERSATION_URL)
            reset_response = await client.post(CONVERSATION_URL)
            return get_response, reset_response

    get_response, reset_response = _run(scenario)

    assert get_response.status_code == 200
    assert sentinel in json.dumps(get_response.json())  # the sentinel really is on the wire
    assert reset_response.status_code == 201

    captured = capsys.readouterr().out
    assert sentinel not in captured
    for record in caplog.records:
        assert sentinel not in record.getMessage()
