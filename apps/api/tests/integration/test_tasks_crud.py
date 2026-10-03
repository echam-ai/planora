"""Integration tests for `/api/v1/tasks` (issue #28, spec §5, §6.1, §7.1,
§9.1, §13.1, §15.1).

Uses the HTTPX `AsyncClient` against the real ASGI app, exactly like
`tests/integration/test_auth_select_profile.py` — no browser needed.
`migrated_session_factory` applies the Alembic migration to a disposable
SQLite file under the repo's `.tmp/`, and `app_factory()` builds a fresh app
per test against that same database through `DATABASE_URL`. `make_client`
sends the configured `APP_ORIGIN` as `Origin` by default, satisfying issue
#26's CSRF middleware for every test that doesn't exercise it directly.
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
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.api.deps import get_current_time
from planora_api.db.models import Task, TaskCategory, TaskPriority, TaskStatus

TASKS_URL = "/api/v1/tasks"
FOREIGN_ORIGIN = "https://evil.example"


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _select_profile(client: AsyncClient) -> None:
    client.headers["X-Planora-Profile"] = "hamster_knight"


def _seed_task(
    session_factory: sessionmaker[Session], **overrides: Any
) -> uuid.UUID:
    defaults: dict[str, Any] = {
        "title": "Existing task",
        "content": "Existing content",
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


def _all_tasks(session_factory: sessionmaker[Session]) -> list[Task]:
    with session_factory() as session:
        return list(session.execute(select(Task)).scalars().all())


def _fixed_clock(app: FastAPI, now: datetime) -> None:
    app.dependency_overrides[get_current_time] = lambda: now


def _parse(value: str) -> datetime:
    """Parse a wire timestamp, accepting either `Z` or `+00:00` (both are
    valid per the acceptance criteria; pydantic v2 emits `Z`)."""
    return datetime.fromisoformat(value)


# --- Create — defaults, generated fields, position --------------------------


def test_create_with_only_required_fields_uses_defaults(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            create_response = await client.post(
                TASKS_URL, json={"title": "Write report", "content": "Q3 numbers"}
            )
            task_id = create_response.json()["id"]
            get_response = await client.get(f"{TASKS_URL}/{task_id}")
            return create_response, get_response

    create_response, get_response = _run(scenario)

    assert create_response.status_code == 201
    body = create_response.json()
    assert body["status"] == "todo"
    assert body["priority"] == "medium"
    assert body["category"] == "other"
    assert body["deadline_at"] is None
    assert body["urls"] == []
    assert body["markdown_note"] == ""
    assert body["completed_at"] is None
    assert body["archived_at"] is None
    assert uuid.UUID(body["id"])
    assert set(body.keys()) == {
        "id", "title", "content", "status", "category", "priority",
        "deadline_at", "urls", "markdown_note", "position", "created_at",
        "updated_at", "completed_at", "archived_at",
    }

    assert get_response.status_code == 200
    assert get_response.json() == body


def test_new_tasks_go_to_the_end_of_the_todo_column(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_task(migrated_session_factory, title="A", position=1.0)
    _seed_task(migrated_session_factory, title="B", position=2.0)
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(
                TASKS_URL, json={"title": "C", "content": "third"}
            )

    response = _run(scenario)

    assert response.status_code == 201
    positions = [t.position for t in _all_tasks(migrated_session_factory)]
    assert response.json()["position"] > max(positions[:2])
    assert response.json()["position"] == max(positions)


def test_task_created_done_gets_completed_at(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    now = datetime(2026, 9, 27, 10, 0, 0, tzinfo=UTC)
    _fixed_clock(app, now)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(
                TASKS_URL,
                json={"title": "Done already", "content": "x", "status": "done"},
            )

    response = _run(scenario)

    assert response.status_code == 201
    assert _parse(response.json()["completed_at"]) == now


@pytest.mark.parametrize("status", ["todo", "in_progress"])
def test_task_created_not_done_has_no_completed_at(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    status: str,
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(
                TASKS_URL, json={"title": "T", "content": "x", "status": status}
            )

    response = _run(scenario)

    assert response.status_code == 201
    assert response.json()["completed_at"] is None


# --- Missing/blank required fields -------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"content": "no title"},
        {"title": "   ", "content": "blank title"},
        {"title": "no content"},
        {"title": "blank content", "content": "   "},
    ],
)
def test_missing_or_blank_required_fields_are_rejected(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    body: dict[str, str],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(TASKS_URL, json=body)

    response = _run(scenario)

    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "VALIDATION_ERROR"
    fields = {detail["field"] for detail in payload["details"]}
    assert fields & {"title", "content"}
    assert _all_tasks(migrated_session_factory) == []


# --- Invalid enum values ------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("category", "errand"),
        ("priority", "urgent"),
        ("status", "archived"),
        ("status", "Todo"),  # case variant — the wire enum is lowercase only
    ],
)
def test_invalid_enum_values_are_rejected_on_create(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    field: str,
    value: str,
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(
                TASKS_URL,
                json={"title": "T", "content": "c", field: value},
            )

    response = _run(scenario)

    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "VALIDATION_ERROR"
    assert any(detail["field"] == field for detail in payload["details"])
    assert _all_tasks(migrated_session_factory) == []


@pytest.mark.parametrize(
    ("field", "value"),
    [("category", "errand"), ("priority", "urgent"), ("status", "archived")],
)
def test_invalid_enum_values_are_rejected_on_patch(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    field: str,
    value: str,
) -> None:
    task_id = _seed_task(migrated_session_factory, title="Untouched")
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(f"{TASKS_URL}/{task_id}", json={field: value})

    response = _run(scenario)

    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "VALIDATION_ERROR"
    assert any(detail["field"] == field for detail in payload["details"])
    stored = _all_tasks(migrated_session_factory)[0]
    assert stored.title == "Untouched"


def test_patch_unknown_id_returns_404_and_writes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    unknown_id = uuid.uuid4()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(
                f"{TASKS_URL}/{unknown_id}", json={"title": "x"}
            )

    response = _run(scenario)

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"
    assert _all_tasks(migrated_session_factory) == []


def test_patch_blank_title_is_rejected(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory, title="Keep me")
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(
                f"{TASKS_URL}/{task_id}", json={"title": "   "}
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    stored = _all_tasks(migrated_session_factory)[0]
    assert stored.title == "Keep me"


def test_patch_unsafe_url_scheme_is_rejected(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory)
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(
                f"{TASKS_URL}/{task_id}",
                json={"urls": [{"url": "javascript:alert(1)"}]},
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_patch_naive_deadline_is_rejected(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory)
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(
                f"{TASKS_URL}/{task_id}",
                json={"deadline_at": "2026-10-01T09:00:00"},
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_url_entry_with_an_id_field_is_rejected(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    """The user's non-scope decision on #28: URL entries stay id-less on the
    wire. A client sending one anyway is rejected like any other unknown
    field, not silently dropped."""
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(
                TASKS_URL,
                json={
                    "title": "T", "content": "c",
                    "urls": [{"url": "https://example.com", "id": "abc123"}],
                },
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert _all_tasks(migrated_session_factory) == []


# --- URLs and deadline validation ---------------------------------------------


def test_unsafe_url_scheme_is_rejected(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(
                TASKS_URL,
                json={
                    "title": "T", "content": "c",
                    "urls": [{"url": "javascript:alert(1)"}],
                },
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert _all_tasks(migrated_session_factory) == []


def test_naive_deadline_is_rejected(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(
                TASKS_URL,
                json={
                    "title": "T", "content": "c",
                    "deadline_at": "2026-10-01T09:00:00",
                },
            )

    response = _run(scenario)

    assert response.status_code == 422
    payload = response.json()
    assert payload["code"] == "VALIDATION_ERROR"
    assert any(detail["field"] == "deadline_at" for detail in payload["details"])
    assert _all_tasks(migrated_session_factory) == []


def test_deadline_with_offset_is_normalized_to_utc(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(
                TASKS_URL,
                json={
                    "title": "T", "content": "c",
                    "deadline_at": "2026-10-01T09:00:00+07:00",
                },
            )

    response = _run(scenario)

    assert response.status_code == 201
    deadline_at = response.json()["deadline_at"]
    parsed = datetime.fromisoformat(deadline_at)
    assert parsed == datetime(2026, 10, 1, 2, 0, 0, tzinfo=UTC)
    assert parsed.utcoffset() == timedelta(0)


# --- Server-owned and unknown fields ------------------------------------------


@pytest.mark.parametrize(
    "field",
    ["id", "position", "created_at", "updated_at", "completed_at", "archived_at"],
)
def test_server_owned_field_is_rejected(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    field: str,
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(
                TASKS_URL, json={"title": "T", "content": "c", field: "x"}
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert _all_tasks(migrated_session_factory) == []


def test_unknown_field_is_rejected(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.post(
                TASKS_URL,
                json={"title": "T", "content": "c", "not_a_real_field": True},
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert _all_tasks(migrated_session_factory) == []


# --- List and read: archived hidden, order, 404, malformed id ---------------


def test_list_is_empty_on_an_empty_database(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.get(TASKS_URL)

    response = _run(scenario)

    assert response.status_code == 200
    assert response.json() == []


def test_archived_tasks_are_hidden_from_active_endpoints(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    active_id = _seed_task(migrated_session_factory, title="Active", position=1.0)
    archived_id = _seed_task(
        migrated_session_factory,
        title="Archived",
        position=2.0,
        archived_at=datetime(2026, 9, 1, tzinfo=UTC),
    )
    app = app_factory()

    async def scenario() -> tuple[Response, Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            list_response = await client.get(TASKS_URL)
            get_response = await client.get(f"{TASKS_URL}/{archived_id}")
            patch_response = await client.patch(
                f"{TASKS_URL}/{archived_id}", json={"title": "renamed"}
            )
            return list_response, get_response, patch_response

    list_response, get_response, patch_response = _run(scenario)

    assert list_response.status_code == 200
    ids = [task["id"] for task in list_response.json()]
    assert ids == [str(active_id)]

    assert get_response.status_code == 404
    assert get_response.json()["code"] == "NOT_FOUND"

    assert patch_response.status_code == 404
    assert patch_response.json()["code"] == "NOT_FOUND"


def test_list_order_is_by_status_column_then_position(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_task(migrated_session_factory, title="done-1", status=TaskStatus.DONE, position=1.0)
    _seed_task(migrated_session_factory, title="todo-2", status=TaskStatus.TODO, position=2.0)
    _seed_task(migrated_session_factory, title="todo-1", status=TaskStatus.TODO, position=1.0)
    _seed_task(migrated_session_factory, title="in-progress-1", status=TaskStatus.IN_PROGRESS, position=1.0)
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.get(TASKS_URL)

    response = _run(scenario)

    assert response.status_code == 200
    titles = [task["title"] for task in response.json()]
    assert titles == ["todo-1", "todo-2", "in-progress-1", "done-1"]


def test_get_unknown_id_returns_404(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    unknown_id = uuid.uuid4()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.get(f"{TASKS_URL}/{unknown_id}")

    response = _run(scenario)

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_malformed_id_returns_422_not_500(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    method: str,
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            request = getattr(client, method)
            if method == "patch":
                return await request(f"{TASKS_URL}/not-a-uuid", json={"title": "x"})
            return await request(f"{TASKS_URL}/not-a-uuid")

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


# --- Partial update -----------------------------------------------------------


def test_partial_update_changes_only_given_fields(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(
        migrated_session_factory,
        title="Original",
        content="Original content",
        markdown_note="# Notes",
        deadline_at=datetime(2026, 10, 1, tzinfo=UTC),
        created_at=datetime(2026, 9, 1, tzinfo=UTC),
        updated_at=datetime(2026, 9, 1, tzinfo=UTC),
    )
    app = app_factory()
    later = datetime(2026, 9, 27, 12, 0, 0, tzinfo=UTC)
    _fixed_clock(app, later)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(
                f"{TASKS_URL}/{task_id}",
                json={"title": "Renamed", "deadline_at": None},
            )

    response = _run(scenario)

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Renamed"
    assert body["deadline_at"] is None
    assert body["content"] == "Original content"
    assert body["markdown_note"] == "# Notes"
    assert _parse(body["created_at"]) == datetime(2026, 9, 1, tzinfo=UTC)
    assert datetime.fromisoformat(body["updated_at"]) > datetime(2026, 9, 1, tzinfo=UTC)
    assert body["id"] == str(task_id)


def test_patch_explicit_null_title_or_content_is_rejected(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory, title="Keep me")
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            title_response = await client.patch(
                f"{TASKS_URL}/{task_id}", json={"title": None}
            )
            content_response = await client.patch(
                f"{TASKS_URL}/{task_id}", json={"content": None}
            )
            return title_response, content_response

    title_response, content_response = _run(scenario)

    assert title_response.status_code == 422
    assert content_response.status_code == 422
    stored = _all_tasks(migrated_session_factory)[0]
    assert stored.title == "Keep me"


def test_patch_rejects_server_owned_and_unknown_fields(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory)
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            owned = await client.patch(
                f"{TASKS_URL}/{task_id}", json={"id": str(uuid.uuid4())}
            )
            unknown = await client.patch(
                f"{TASKS_URL}/{task_id}", json={"not_real": 1}
            )
            return owned, unknown

    owned_response, unknown_response = _run(scenario)

    assert owned_response.status_code == 422
    assert unknown_response.status_code == 422


# --- Successful PATCH of each individually-updatable field -------------------


_SEED_DEFAULTS: dict[str, Any] = {
    "title": "Original title",
    "content": "Original content",
    "category": "work",
    "priority": "medium",
    "markdown_note": "Original note",
}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("content", "New content"),
        ("category", "study"),
        ("priority", "high"),
        ("markdown_note", "# Updated notes"),
    ],
)
def test_patch_successfully_updates_a_single_field(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    field: str,
    value: str,
) -> None:
    original_updated_at = datetime(2026, 9, 1, tzinfo=UTC)
    task_id = _seed_task(
        migrated_session_factory,
        title=_SEED_DEFAULTS["title"],
        content=_SEED_DEFAULTS["content"],
        category=TaskCategory.WORK,
        priority=TaskPriority.MEDIUM,
        markdown_note=_SEED_DEFAULTS["markdown_note"],
        updated_at=original_updated_at,
    )
    app = app_factory()
    later = datetime(2026, 9, 27, 12, 0, 0, tzinfo=UTC)
    _fixed_clock(app, later)

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            patch_response = await client.patch(
                f"{TASKS_URL}/{task_id}", json={field: value}
            )
            get_response = await client.get(f"{TASKS_URL}/{task_id}")
            return patch_response, get_response

    patch_response, get_response = _run(scenario)

    assert patch_response.status_code == 200
    body = patch_response.json()
    assert body[field] == value

    assert get_response.status_code == 200
    assert get_response.json() == body

    for key, expected in _SEED_DEFAULTS.items():
        if key != field:
            assert body[key] == expected, f"{key} should be unchanged"

    assert _parse(body["updated_at"]) > original_updated_at


def test_patch_replaces_the_urls_list(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    original_updated_at = datetime(2026, 9, 1, tzinfo=UTC)
    task_id = _seed_task(
        migrated_session_factory,
        title=_SEED_DEFAULTS["title"],
        urls=[{"url": "https://old.example", "label": "Old"}],
        updated_at=original_updated_at,
    )
    app = app_factory()
    later = datetime(2026, 9, 27, 12, 0, 0, tzinfo=UTC)
    _fixed_clock(app, later)
    new_urls = [
        {"url": "https://new.example", "label": "New"},
        {"url": "https://second.example"},
    ]

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            patch_response = await client.patch(
                f"{TASKS_URL}/{task_id}", json={"urls": new_urls}
            )
            get_response = await client.get(f"{TASKS_URL}/{task_id}")
            return patch_response, get_response

    patch_response, get_response = _run(scenario)

    assert patch_response.status_code == 200
    body = patch_response.json()
    assert body["urls"] == [
        {"url": "https://new.example", "label": "New"},
        {"url": "https://second.example", "label": None},
    ]
    assert get_response.status_code == 200
    assert get_response.json() == body
    assert body["title"] == _SEED_DEFAULTS["title"]
    assert _parse(body["updated_at"]) > original_updated_at


def test_patch_clears_the_urls_list_to_empty(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    original_updated_at = datetime(2026, 9, 1, tzinfo=UTC)
    task_id = _seed_task(
        migrated_session_factory,
        title=_SEED_DEFAULTS["title"],
        urls=[{"url": "https://old.example", "label": "Old"}],
        updated_at=original_updated_at,
    )
    app = app_factory()
    later = datetime(2026, 9, 27, 12, 0, 0, tzinfo=UTC)
    _fixed_clock(app, later)

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            patch_response = await client.patch(
                f"{TASKS_URL}/{task_id}", json={"urls": []}
            )
            get_response = await client.get(f"{TASKS_URL}/{task_id}")
            return patch_response, get_response

    patch_response, get_response = _run(scenario)

    assert patch_response.status_code == 200
    body = patch_response.json()
    assert body["urls"] == []
    assert get_response.status_code == 200
    assert get_response.json() == body
    assert body["title"] == _SEED_DEFAULTS["title"]
    assert _parse(body["updated_at"]) > original_updated_at


# --- Status change: completed_at and position --------------------------------


def test_status_change_through_patch_keeps_completed_at_consistent(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory, status=TaskStatus.TODO)
    app = app_factory()
    t1 = datetime(2026, 9, 27, 9, 0, 0, tzinfo=UTC)
    t2 = datetime(2026, 9, 27, 10, 0, 0, tzinfo=UTC)
    t3 = datetime(2026, 9, 27, 11, 0, 0, tzinfo=UTC)

    async def scenario() -> tuple[Response, Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)

            _fixed_clock(app, t1)
            to_done = await client.patch(
                f"{TASKS_URL}/{task_id}", json={"status": "done"}
            )

            _fixed_clock(app, t2)
            title_only = await client.patch(
                f"{TASKS_URL}/{task_id}", json={"title": "still done"}
            )

            _fixed_clock(app, t3)
            to_in_progress = await client.patch(
                f"{TASKS_URL}/{task_id}", json={"status": "in_progress"}
            )
            return to_done, title_only, to_in_progress

    to_done, title_only, to_in_progress = _run(scenario)

    assert to_done.status_code == 200
    assert _parse(to_done.json()["completed_at"]) == t1
    assert to_done.json()["status"] == "done"

    assert title_only.status_code == 200
    assert _parse(title_only.json()["completed_at"]) == t1

    assert to_in_progress.status_code == 200
    assert to_in_progress.json()["completed_at"] is None
    assert to_in_progress.json()["status"] == "in_progress"


def test_status_change_places_task_last_in_new_column(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_task(
        migrated_session_factory,
        title="done-existing",
        status=TaskStatus.DONE,
        position=1.0,
    )
    moving_id = _seed_task(
        migrated_session_factory, title="moving", status=TaskStatus.TODO, position=1.0
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(
                f"{TASKS_URL}/{moving_id}", json={"status": "done"}
            )

    response = _run(scenario)

    assert response.status_code == 200
    tasks = _all_tasks(migrated_session_factory)
    done_tasks = sorted(
        (t for t in tasks if t.status == TaskStatus.DONE), key=lambda t: t.position
    )
    assert [t.title for t in done_tasks] == ["done-existing", "moving"]


def test_patch_same_status_leaves_position_unchanged(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory, status=TaskStatus.TODO, position=5.0)
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(
                f"{TASKS_URL}/{task_id}", json={"status": "todo"}
            )

    response = _run(scenario)

    assert response.status_code == 200
    assert response.json()["position"] == 5.0


# --- Rejected PATCH leaves the row unchanged ---------------------------------


def test_rejected_patch_leaves_updated_at_unchanged(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    original_updated_at = datetime(2026, 9, 1, tzinfo=UTC)
    task_id = _seed_task(
        migrated_session_factory, updated_at=original_updated_at
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(
                f"{TASKS_URL}/{task_id}", json={"priority": "urgent"}
            )

    response = _run(scenario)

    assert response.status_code == 422
    stored = _all_tasks(migrated_session_factory)[0]
    assert stored.updated_at == original_updated_at


# --- Delete -------------------------------------------------------------------


def test_delete_active_task_removes_row_and_keeps_sibling_positions(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_a = _seed_task(migrated_session_factory, title="A", position=1.0)
    task_b = _seed_task(migrated_session_factory, title="B", position=2.0)
    task_c = _seed_task(migrated_session_factory, title="C", position=3.0)
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            delete_response = await client.delete(f"{TASKS_URL}/{task_b}")
            get_response = await client.get(f"{TASKS_URL}/{task_b}")
            return delete_response, get_response

    delete_response, get_response = _run(scenario)

    assert delete_response.status_code == 204
    assert delete_response.content == b""
    assert get_response.status_code == 404

    remaining = {t.id: t.position for t in _all_tasks(migrated_session_factory)}
    assert task_b not in remaining
    assert remaining[task_a] == 1.0
    assert remaining[task_c] == 3.0


def test_delete_refuses_missing_archived_and_malformed_ids(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    archived_id = _seed_task(
        migrated_session_factory,
        title="Archived",
        archived_at=datetime(2026, 9, 1, tzinfo=UTC),
    )
    unknown_id = uuid.uuid4()
    app = app_factory()

    async def scenario() -> tuple[Response, Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            unknown_response = await client.delete(f"{TASKS_URL}/{unknown_id}")
            archived_response = await client.delete(f"{TASKS_URL}/{archived_id}")
            malformed_response = await client.delete(f"{TASKS_URL}/not-a-uuid")
            return unknown_response, archived_response, malformed_response

    unknown_response, archived_response, malformed_response = _run(scenario)

    assert unknown_response.status_code == 404
    assert archived_response.status_code == 404
    assert malformed_response.status_code == 422

    remaining_ids = {t.id for t in _all_tasks(migrated_session_factory)}
    assert archived_id in remaining_ids


# --- Auth and CSRF -------------------------------------------------------------


def test_unauthenticated_requests_return_422(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory)
    app = app_factory()

    async def scenario() -> list[Response]:
        async with make_client(app) as client:
            return [
                await client.get(TASKS_URL),
                await client.post(TASKS_URL, json={"title": "T", "content": "c"}),
                await client.get(f"{TASKS_URL}/{task_id}"),
                await client.patch(f"{TASKS_URL}/{task_id}", json={"title": "x"}),
                await client.delete(f"{TASKS_URL}/{task_id}"),
            ]

    responses = _run(scenario)

    for response in responses:
        assert response.status_code == 422
        assert response.json()["code"] == "VALIDATION_ERROR"

    assert _all_tasks(migrated_session_factory)[0].title != "x"
    assert len(_all_tasks(migrated_session_factory)) == 1


def test_cross_origin_writes_return_403_and_write_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_task(migrated_session_factory, title="Untouched")
    app = app_factory()

    async def scenario() -> list[Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            foreign = {"Origin": FOREIGN_ORIGIN}
            return [
                await client.post(
                    TASKS_URL, json={"title": "T", "content": "c"}, headers=foreign
                ),
                await client.patch(
                    f"{TASKS_URL}/{task_id}", json={"title": "x"}, headers=foreign
                ),
                await client.delete(f"{TASKS_URL}/{task_id}", headers=foreign),
            ]

    responses = _run(scenario)

    for response in responses:
        assert response.status_code == 403
        assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"

    tasks = _all_tasks(migrated_session_factory)
    assert len(tasks) == 1
    assert tasks[0].title == "Untouched"


# --- Transactional commit --------------------------------------------------


def test_a_failed_commit_is_not_reported_as_success(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)

            original_commit = Session.commit

            def failing_commit(self: Session) -> None:
                raise RuntimeError("simulated commit failure")

            Session.commit = failing_commit  # type: ignore[method-assign]
            try:
                return await client.post(
                    TASKS_URL, json={"title": "T", "content": "c"}
                )
            finally:
                Session.commit = original_commit  # type: ignore[method-assign]

    response = _run(scenario)

    assert not (200 <= response.status_code < 300)
    assert _all_tasks(migrated_session_factory) == []


# --- OpenAPI documentation ----------------------------------------------------


def test_openapi_documents_error_responses_and_enums(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()
    schema = app.openapi()
    paths = schema["paths"]

    def _refs_error_response(responses: dict[str, Any], status: str) -> bool:
        ref = responses[status]["content"]["application/json"]["schema"].get("$ref", "")
        return ref.endswith("/ErrorResponse")

    post = paths["/api/v1/tasks"]["post"]["responses"]
    assert "401" not in post
    assert _refs_error_response(post, "403")
    assert _refs_error_response(post, "422")

    get_item = paths["/api/v1/tasks/{task_id}"]["get"]["responses"]
    assert "404" in get_item

    patch_item = paths["/api/v1/tasks/{task_id}"]["patch"]["responses"]
    assert "401" not in patch_item
    assert _refs_error_response(patch_item, "403")
    assert _refs_error_response(patch_item, "422")
    assert "404" in patch_item

    delete_item = paths["/api/v1/tasks/{task_id}"]["delete"]["responses"]
    assert "401" not in delete_item
    assert _refs_error_response(delete_item, "403")
    assert _refs_error_response(delete_item, "422")
    assert "404" in delete_item
    assert "204" in delete_item

    schemas = schema["components"]["schemas"]
    assert set(schemas["TaskStatus"]["enum"]) == {"todo", "in_progress", "done"}
    assert set(schemas["TaskCategory"]["enum"]) == {
        "work", "personal", "study", "other",
    }
    assert set(schemas["TaskPriority"]["enum"]) == {"low", "medium", "high"}
