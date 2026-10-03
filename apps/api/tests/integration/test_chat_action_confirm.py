"""Integration tests for `POST /api/v1/chat/actions/{id}/confirm` and
`.../reject` (issue #41, spec §10.1-§10.4).

Seeds a `pending`/`applied`/`rejected` `ChatAction` directly through
`db.chat_action_repository.create_action`, matching how
`tests/integration/test_chat_conversation.py` seeds messages directly
through `db.chat_repository.append_message` rather than always driving a
full chat turn first.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import make_client
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.api.deps import get_current_time
from planora_api.db import chat_action_repository, chat_repository
from planora_api.db.models import (
    ChatActionKind,
    ChatActionStatus,
    ChatRole,
    Task,
    TaskCategory,
    TaskPriority,
    TaskStatus,
)
from planora_api.domain.chat_actions import ActionField

NOW = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)
FOREIGN_ORIGIN = "https://evil.example"


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _select_profile(client: AsyncClient) -> None:
    client.headers["X-Planora-Profile"] = "hamster_knight"


def _fixed_clock(app: FastAPI, now: datetime = NOW) -> None:
    app.dependency_overrides[get_current_time] = lambda: now


def _confirm_url(action_id: object) -> str:
    return f"/api/v1/chat/actions/{action_id}/confirm"


def _reject_url(action_id: object) -> str:
    return f"/api/v1/chat/actions/{action_id}/reject"


def _seed_task(session_factory: sessionmaker[Session], **overrides: Any) -> uuid.UUID:
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


def _get_task(session_factory: sessionmaker[Session], task_id: uuid.UUID) -> Task:
    with session_factory() as session:
        task = session.get(Task, task_id)
        assert task is not None
        return task


def _seed_create_action(
    session_factory: sessionmaker[Session], *, status: ChatActionStatus = ChatActionStatus.PENDING
) -> uuid.UUID:
    with session_factory() as session:
        message = chat_repository.append_message(session, role=ChatRole.ASSISTANT, text="Preview.", now=NOW)
        action = chat_action_repository.create_action(
            session,
            message_id=message.id,
            kind=ChatActionKind.CREATE,
            title="Create task",
            summary="New task",
            fields=[ActionField("Title", None, "New task")],
            payload={
                "draft": {
                    "title": "New task",
                    "content": "Content",
                    "category": "work",
                    "priority": "medium",
                    "deadline_at": None,
                    "urls": [],
                    "markdown_note": "",
                }
            },
            task_id=None,
            stale_snapshot={},
            changed_fields=None,
            now=NOW,
        )
        if status != ChatActionStatus.PENDING:
            action.status = status
            action.updated_at = NOW
        session.commit()
        return action.id


def _seed_move_action(
    session_factory: sessionmaker[Session],
    *,
    task_id: uuid.UUID,
    from_status: str,
    to_status: str,
) -> uuid.UUID:
    with session_factory() as session:
        message = chat_repository.append_message(session, role=ChatRole.ASSISTANT, text="Preview.", now=NOW)
        action = chat_action_repository.create_action(
            session,
            message_id=message.id,
            kind=ChatActionKind.MOVE,
            title="Move task",
            summary="Task",
            fields=[ActionField("Status", from_status.title(), to_status.title())],
            payload={"task_id": str(task_id), "status": to_status},
            task_id=task_id,
            stale_snapshot={"status": from_status},
            changed_fields=None,
            now=NOW,
        )
        session.commit()
        return action.id


def _seed_update_action(
    session_factory: sessionmaker[Session], *, task_id: uuid.UUID, from_priority: str, to_priority: str
) -> uuid.UUID:
    with session_factory() as session:
        message = chat_repository.append_message(session, role=ChatRole.ASSISTANT, text="Preview.", now=NOW)
        action = chat_action_repository.create_action(
            session,
            message_id=message.id,
            kind=ChatActionKind.UPDATE,
            title="Update task",
            summary="Task",
            fields=[ActionField("Priority", from_priority.title(), to_priority.title())],
            payload={
                "task_id": str(task_id),
                "draft": {
                    "title": "Task",
                    "content": "Content",
                    "category": "work",
                    "priority": to_priority,
                    "deadline_at": None,
                    "urls": [],
                    "markdown_note": "",
                },
            },
            task_id=task_id,
            stale_snapshot={"priority": from_priority},
            changed_fields={"priority": to_priority},
            now=NOW,
        )
        session.commit()
        return action.id


# --- Scenario: user confirms a proposed task creation -----------------------


def test_confirm_create_action_creates_task_and_appends_confirmation_message(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    action_id = _seed_create_action(migrated_session_factory)
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(_confirm_url(action_id))

    response = _run(scenario)
    assert response.status_code == 200
    body = response.json()

    with migrated_session_factory() as session:
        tasks = session.execute(select(Task)).scalars().all()
    assert len(tasks) == 1
    assert tasks[0].title == "New task"
    assert tasks[0].status == TaskStatus.TODO

    action = next(
        m["action"] for m in body["messages"] if m.get("action") and m["action"]["id"] == str(action_id)
    )
    assert action["status"] == "applied"
    assert body["messages"][-1]["text"] == "Done — I applied that change to your board."
    assert body["messages"][-1]["action"] is None


def test_confirming_an_applied_action_again_is_idempotent(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    action_id = _seed_create_action(migrated_session_factory)
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            first = await client.post(_confirm_url(action_id))
            second = await client.post(_confirm_url(action_id))
            return first, second

    first, second = _run(scenario)
    assert first.status_code == 200
    assert second.status_code == 200

    with migrated_session_factory() as session:
        tasks = session.execute(select(Task)).scalars().all()
    assert len(tasks) == 1

    confirmation_texts = [
        m["text"] for m in second.json()["messages"] if m["text"].startswith("Done")
    ]
    assert len(confirmation_texts) == 1


# --- Scenario: user cancels a proposed move -----------------------------------


def test_reject_then_confirm_returns_already_rejected_and_writes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory, status=TaskStatus.TODO)
    action_id = _seed_move_action(
        migrated_session_factory, task_id=task_id, from_status="todo", to_status="done"
    )
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            rejected = await client.post(_reject_url(action_id))
            confirmed = await client.post(_confirm_url(action_id))
            return rejected, confirmed

    rejected, confirmed = _run(scenario)
    assert rejected.status_code == 200
    assert confirmed.status_code == 409
    assert confirmed.json()["code"] == "ACTION_ALREADY_REJECTED"

    task = _get_task(migrated_session_factory, task_id)
    assert task.status == TaskStatus.TODO
    assert task.completed_at is None


def test_rejecting_an_already_rejected_action_is_idempotent(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    action_id = _seed_create_action(migrated_session_factory, status=ChatActionStatus.REJECTED)
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(_reject_url(action_id))

    response = _run(scenario)
    assert response.status_code == 200


def test_confirming_a_rejected_action_directly_returns_409(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    action_id = _seed_create_action(migrated_session_factory, status=ChatActionStatus.REJECTED)
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(_confirm_url(action_id))

    response = _run(scenario)
    assert response.status_code == 409
    assert response.json()["code"] == "ACTION_ALREADY_REJECTED"
    assert "cancelled" in response.json()["message"].lower()


def test_rejecting_an_applied_action_returns_409(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    action_id = _seed_create_action(migrated_session_factory, status=ChatActionStatus.APPLIED)
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(_reject_url(action_id))

    response = _run(scenario)
    assert response.status_code == 409
    assert response.json()["code"] == "ACTION_ALREADY_APPLIED"


# --- Scenario: confirmed move into and out of Done --------------------------


def test_confirmed_move_into_done_sets_completed_at_and_out_clears_it(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory, status=TaskStatus.TODO)
    into_done_action = _seed_move_action(
        migrated_session_factory, task_id=task_id, from_status="todo", to_status="done"
    )
    app = app_factory()
    _fixed_clock(app)

    async def confirm_into_done() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(_confirm_url(into_done_action))

    response = _run(confirm_into_done)
    assert response.status_code == 200
    task = _get_task(migrated_session_factory, task_id)
    assert task.status == TaskStatus.DONE
    assert task.completed_at == NOW

    out_of_done_action = _seed_move_action(
        migrated_session_factory, task_id=task_id, from_status="done", to_status="todo"
    )
    later = NOW + timedelta(hours=1)
    app2 = app_factory()
    _fixed_clock(app2, later)

    async def confirm_out_of_done() -> Response:
        async with make_client(app2) as client:
            await _select_profile(client)
            return await client.post(_confirm_url(out_of_done_action))

    response2 = _run(confirm_out_of_done)
    assert response2.status_code == 200
    task2 = _get_task(migrated_session_factory, task_id)
    assert task2.status == TaskStatus.TODO
    assert task2.completed_at is None


# --- Scenario: user confirms an edit whose task changed meanwhile -----------


def test_confirm_update_after_task_patched_meanwhile_is_stale(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory, priority=TaskPriority.LOW)
    action_id = _seed_update_action(
        migrated_session_factory, task_id=task_id, from_priority="low", to_priority="high"
    )
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            patched = await client.patch(f"/api/v1/tasks/{task_id}", json={"priority": "medium"})
            assert patched.status_code == 200
            return await client.post(_confirm_url(action_id))

    response = _run(scenario)
    assert response.status_code == 409
    assert response.json()["code"] == "ACTION_STALE"

    task = _get_task(migrated_session_factory, task_id)
    assert task.priority == TaskPriority.MEDIUM


@pytest.mark.parametrize("delete_or_archive", ["delete", "archive"])
def test_confirm_update_after_task_deleted_or_archived_is_stale(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    delete_or_archive: str,
) -> None:
    task_id = _seed_task(migrated_session_factory, priority=TaskPriority.LOW)
    action_id = _seed_update_action(
        migrated_session_factory, task_id=task_id, from_priority="low", to_priority="high"
    )

    if delete_or_archive == "delete":
        with migrated_session_factory() as session:
            task = session.get(Task, task_id)
            assert task is not None
            session.delete(task)
            session.commit()
    else:
        with migrated_session_factory() as session:
            task = session.get(Task, task_id)
            assert task is not None
            task.archived_at = NOW
            session.commit()

    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(_confirm_url(action_id))

    response = _run(scenario)
    assert response.status_code == 409
    assert response.json()["code"] == "ACTION_STALE"


# --- Scenario: user confirms after starting a new conversation -------------


def test_confirm_after_conversation_reset_returns_404(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    action_id = _seed_create_action(migrated_session_factory)
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            reset = await client.post("/api/v1/chat/conversation")
            assert reset.status_code == 201
            return await client.post(_confirm_url(action_id))

    response = _run(scenario)
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"

    with migrated_session_factory() as session:
        assert session.execute(select(func.count()).select_from(Task)).scalar_one() == 0


def test_confirm_unknown_id_returns_404(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(_confirm_url(uuid.uuid4()))

    response = _run(scenario)
    assert response.status_code == 404


def test_reject_unknown_id_returns_404(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(_reject_url(uuid.uuid4()))

    response = _run(scenario)
    assert response.status_code == 404


# --- Auth, CSRF, malformed id -------------------------------------------------


def test_confirm_requires_a_session(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    action_id = _seed_create_action(migrated_session_factory)
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.post(_confirm_url(action_id))

    response = _run(scenario)
    assert response.status_code == 422


def test_confirm_rejects_a_foreign_origin(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    action_id = _seed_create_action(migrated_session_factory)
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as login_client:
            await _select_profile(login_client)
            cookies = dict(login_client.cookies)

        async with make_client(app, origin=FOREIGN_ORIGIN) as client:
            client.cookies.update(cookies)
            return await client.post(_confirm_url(action_id))

    response = _run(scenario)
    assert response.status_code == 403


def test_confirm_malformed_id_returns_422(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post("/api/v1/chat/actions/not-a-uuid/confirm")

    response = _run(scenario)
    assert response.status_code == 422


def test_reject_malformed_id_returns_422(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post("/api/v1/chat/actions/not-a-uuid/reject")

    response = _run(scenario)
    assert response.status_code == 422


# --- Timezone independence at confirm time -----------------------------------


def test_confirmed_deadline_unaffected_by_a_timezone_change_after_proposal(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    resolved_instant = datetime(2026, 10, 9, 21, 0, tzinfo=UTC)
    with migrated_session_factory() as session:
        message = chat_repository.append_message(session, role=ChatRole.ASSISTANT, text="Preview.", now=NOW)
        action = chat_action_repository.create_action(
            session,
            message_id=message.id,
            kind=ChatActionKind.CREATE,
            title="Create task",
            summary="Timed task",
            fields=[ActionField("Deadline", None, "09 Oct 2026, 17:00")],
            payload={
                "draft": {
                    "title": "Timed task",
                    "content": "Content",
                    "category": "work",
                    "priority": "medium",
                    "deadline_at": resolved_instant.isoformat(),
                    "urls": [],
                    "markdown_note": "",
                }
            },
            task_id=None,
            stale_snapshot={},
            changed_fields=None,
            now=NOW,
        )
        session.commit()
        action_id = action.id

    app = app_factory()
    _fixed_clock(app)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            changed = await client.patch("/api/v1/settings", json={"timezone": "Asia/Tokyo"})
            assert changed.status_code == 200
            return await client.post(_confirm_url(action_id))

    response = _run(scenario)
    assert response.status_code == 200

    with migrated_session_factory() as session:
        tasks = session.execute(select(Task)).scalars().all()
    assert len(tasks) == 1
    assert tasks[0].deadline_at == resolved_instant
