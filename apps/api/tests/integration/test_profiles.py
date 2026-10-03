"""Two fixed unauthenticated profiles, ownership, and legacy upgrade regression."""
from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta

import pytest
from conftest import make_client
from sqlalchemy import select

from planora_api.ai.client import LLMCompletion, LLMToolCall
from planora_api.ai.deps import get_llm_client
from planora_api.ai.fake import FakeLLMClient
from planora_api.db.models import ChatAction, ChatMessage, Task
from planora_api.jobs.archive_done_tasks import archive_done_tasks

KNIGHT = "hamster_knight"
PRINCESS = "ech_princess"
HEADER = "X-Planora-Profile"


def test_catalog_and_no_credentials(migrated_database_url, app_factory, valid_env):
    valid_env.delenv("SESSION_SECRET", raising=False)
    app = app_factory()
    async def scenario():
        async with make_client(app) as client:
            response = await client.get("/api/v1/profiles")
            assert response.status_code == 200
            assert response.json() == [
                {"id": KNIGHT, "name": "Hamster Knight"},
                {"id": PRINCESS, "name": "Ech Princess"},
            ]
            for path in ("/auth/login", "/auth/logout", "/auth/session", "/settings/password"):
                response = await client.request("GET" if path.endswith("session") else "POST", "/api/v1" + path)
                assert response.status_code == 404
                assert "set-cookie" not in response.headers
            for profile in (KNIGHT, PRINCESS):
                response = await client.get("/api/v1/tasks", headers={HEADER: profile})
                assert response.status_code == 200
                assert response.json() == []
                assert "set-cookie" not in response.headers
    asyncio.run(scenario())


@pytest.mark.parametrize("profile", [None, "", "unknown", "Hamster Knight", "HAMSTER_KNIGHT"])
def test_profile_context_required(profile, migrated_database_url, app_factory):
    app = app_factory()
    app.dependency_overrides[get_llm_client] = lambda: FakeLLMClient([])
    async def scenario():
        async with make_client(app) as client:
            client.headers.pop(HEADER, None)
            headers = {} if profile is None else {HEADER: profile}
            for method, path, body in (
                ("GET", "/tasks", None), ("POST", "/tasks", {"title": "x", "content": "y"}),
                ("GET", "/archive", None), ("GET", "/settings", None),
                ("GET", "/chat/conversation", None),
                ("POST", "/ai/parse-task", {"text": "x"}),
            ):
                response = await client.request(method, "/api/v1" + path, headers=headers, json=body)
                assert response.status_code == 422, response.text
                assert response.json()["code"] == "VALIDATION_ERROR"
    asyncio.run(scenario())


def test_tasks_order_archive_settings_and_foreign_ids(migrated_session_factory, app_factory, valid_env):
    valid_env.setenv("LLM_ALLOWED_MODELS", "alternate")
    app = app_factory()
    async def scenario():
        async with make_client(app) as client:
            owned = {}
            for profile in (KNIGHT, PRINCESS):
                client.headers[HEADER] = profile
                result = await client.post("/api/v1/tasks", json={"title": profile, "content": "private"})
                assert result.status_code == 201, result.text
                owned[profile] = result.json()
            assert owned[KNIGHT]["position"] == owned[PRINCESS]["position"]
            foreign = owned[KNIGHT]["id"]
            for method, path, body in (
                ("GET", f"/tasks/{foreign}", None), ("PATCH", f"/tasks/{foreign}", {"title": "stolen"}),
                ("POST", f"/tasks/{foreign}/move", {"status": "done", "index": 0}),
                ("DELETE", f"/tasks/{foreign}", None),
                ("POST", "/tasks/reorder", {"status": "todo", "ordered_ids": [foreign]}),
                ("GET", f"/archive/{foreign}", None),
                ("POST", f"/archive/{foreign}/restore", None), ("DELETE", f"/archive/{foreign}", None),
            ):
                result = await client.request(method, "/api/v1" + path, json=body)
                assert result.status_code == 404, result.text
            result = await client.get("/api/v1/tasks")
            assert [task["id"] for task in result.json()] == [owned[PRINCESS]["id"]]
            await client.patch("/api/v1/settings", json={"timezone": "America/New_York", "model_name": "alternate"})
            client.headers[HEADER] = KNIGHT
            assert (await client.get("/api/v1/settings")).json()["timezone"] == "Europe/Paris"
            assert (await client.get("/api/v1/settings")).json()["model_name"] == "test-model"
            assert (await client.get("/api/v1/tasks")).json()[0]["title"] == KNIGHT
            now = datetime.now(UTC)
            with migrated_session_factory() as db:
                for task in db.execute(select(Task)).scalars():
                    task.status = "done"
                    task.completed_at = now - timedelta(days=8)
                db.commit()
            assert archive_done_tasks(migrated_session_factory, now).archived_count == 2
            for profile in (KNIGHT, PRINCESS):
                client.headers[HEADER] = profile
                result = await client.get("/api/v1/archive", params={"search": profile})
                assert result.json()["total"] == 1
                assert result.json()["items"][0]["id"] == owned[profile]["id"]
                assert (await client.get("/api/v1/archive", params={"search": KNIGHT if profile == PRINCESS else PRINCESS})).json()["total"] == 0
            foreign = owned[KNIGHT]["id"]
            assert (await client.delete(f"/api/v1/archive/{foreign}")).status_code == 404
            assert (await client.post(f"/api/v1/archive/{foreign}/restore")).status_code == 404
            own = owned[PRINCESS]["id"]
            assert (await client.delete(f"/api/v1/archive/{own}")).status_code == 204
            assert (await client.post(f"/api/v1/archive/{own}/restore")).status_code == 404
            client.headers[HEADER] = KNIGHT
            assert (await client.get(f"/api/v1/archive/{foreign}")).status_code == 200
    asyncio.run(scenario())


def completion(text=None, name=None, args=None):
    calls = () if name is None else (LLMToolCall(id="call", name=name, arguments_json=json.dumps(args)),)
    return LLMCompletion(content=text, tool_calls=calls, finish_reason="stop" if text else "tool_calls", usage=None)


def test_chat_proposals_reset_and_deleted_target(migrated_session_factory, app_factory):
    app = app_factory()
    fake = FakeLLMClient([
        completion(name="propose_create_task", args={"title": "Knight task", "content": "private", "category": "work", "priority": "low"}),
        completion("Preview"), completion("Princess hello"),
    ])
    app.dependency_overrides[get_llm_client] = lambda: fake
    async def scenario():
        async with make_client(app) as client:
            client.headers[HEADER] = KNIGHT
            knight = (await client.post("/api/v1/chat/messages", json={"text": "create Knight task"})).json()
            action = knight["messages"][-1]["action"]["id"]
            assert (await client.get("/api/v1/tasks")).json() == []
            client.headers[HEADER] = PRINCESS
            for verb in ("confirm", "reject"):
                assert (await client.post(f"/api/v1/chat/actions/{action}/{verb}")).status_code == 404
            princess = (await client.post("/api/v1/chat/messages", json={"text": "hello"})).json()
            assert princess["id"] != knight["id"]
            assert len(princess["messages"]) == 2
            assert "create Knight task" not in json.dumps(fake.calls[-1].messages)
            client.headers[HEADER] = KNIGHT
            assert (await client.post(f"/api/v1/chat/actions/{action}/confirm")).status_code == 200
            assert (await client.post(f"/api/v1/chat/actions/{action}/confirm")).status_code == 200
            tasks = (await client.get("/api/v1/tasks")).json()
            assert len(tasks) == 1
            task_id = tasks[0]["id"]
            edit_fake = FakeLLMClient([
                completion(name="propose_update_task", args={"task_id": task_id, "title": "Edited"}), completion("Edit preview"),
            ])
            app.dependency_overrides[get_llm_client] = lambda: edit_fake
            edited = (await client.post("/api/v1/chat/messages", json={"text": "edit it"})).json()
            edit_id = edited["messages"][-1]["action"]["id"]
            assert (await client.delete(f"/api/v1/tasks/{task_id}")).status_code == 204
            result = await client.post(f"/api/v1/chat/actions/{edit_id}/confirm")
            assert result.status_code == 409
            assert result.json()["code"] == "ACTION_STALE"
            assert (await client.get("/api/v1/tasks")).json() == []
            assert (await client.patch(f"/api/v1/tasks/{task_id}", json={"title": "again"})).status_code == 404
            await client.post("/api/v1/chat/conversation")
            assert (await client.get("/api/v1/chat/conversation")).json()["messages"] == []
            client.headers[HEADER] = PRINCESS
            assert (await client.get("/api/v1/chat/conversation")).json() == princess
    asyncio.run(scenario())
    with migrated_session_factory() as db:
        assert db.execute(select(Task)).scalars().all() == []
        assert len(db.execute(select(ChatMessage)).scalars().all()) == 2
        assert db.execute(select(ChatAction)).scalars().all() == []


def test_ai_tools_and_cached_foreign_ids_are_scoped(migrated_session_factory, app_factory):
    from planora_api.ai.chat_tools import FindActiveTasksArgs, find_active_tasks
    from planora_api.ai.propose_tools import ProposeUpdateTaskArgs, propose_update_task
    from planora_api.db import chat_action_repository, task_repository
    from planora_api.db.models import (
        ChatActionKind,
        TaskCategory,
        TaskPriority,
        TaskStatus,
    )
    now = datetime.now(UTC)
    with migrated_session_factory() as db:
        task = Task(title="Knight only", content="private", status=TaskStatus.TODO,
                    category=TaskCategory.WORK, priority=TaskPriority.LOW, position=1)
        db.add(task)
        db.flush()
        action = ChatAction(message_id=task.id, task_id=task.id, kind=ChatActionKind.MOVE,
                            title="Move", summary="Knight only", fields=[], payload={},
                            stale_snapshot={}, changed_fields=None)
        db.add(action)
        db.commit()
        task_id, action_id = task.id, action.id
    with migrated_session_factory() as db:
        # Preload foreign objects into the identity map to catch Session.get bypass.
        db.get(Task, task_id)
        db.get(ChatAction, action_id)
        db.info["profile_id"] = 2
        assert task_repository.get_active_task(db, task_id) is None
        assert chat_action_repository.get_action(db, action_id) is None
        assert chat_action_repository._reread_committed(db, action_id) is None
        assert not chat_action_repository.try_mark_applied(db, action_id, now=now)
        assert not chat_action_repository.try_mark_rejected(db, action_id, now=now)
        result = find_active_tasks(db, FindActiveTasksArgs(), now=now, timezone_name="UTC")
        assert "Knight only" not in json.dumps(result)
        result = propose_update_task(db, ProposeUpdateTaskArgs(task_id=task_id, title="stolen"), now, "UTC")
        assert result.proposal is None and result.tool_result == {"error": "invalid_tool_call"}
        db.rollback()
