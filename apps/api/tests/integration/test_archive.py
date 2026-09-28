"""Integration tests for `/api/v1/archive` (issue #30, spec §9.2).

Follows the pattern in `tests/integration/test_tasks_crud.py`: an HTTPX
`AsyncClient` against the real ASGI app, `migrated_session_factory` for a
disposable SQLite database, `app_factory()` for a fresh app per test, and
`make_client` sending the configured `APP_ORIGIN` by default. Archived rows
are seeded by setting `archived_at` directly — the scheduled archive job is
issue #32 and is not needed here.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import AUTH_PASSWORD, AUTH_USERNAME, make_client
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy import insert, select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.api.deps import get_current_time
from planora_api.db.models import Task, TaskCategory, TaskPriority, TaskStatus
from planora_api.domain.archive_policy import is_eligible_for_archive

ARCHIVE_URL = "/api/v1/archive"
TASKS_URL = "/api/v1/tasks"
FOREIGN_ORIGIN = "https://evil.example"


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _login(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD},
    )
    assert response.status_code == 200


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


def _seed_archived_task(
    session_factory: sessionmaker[Session],
    *,
    title: str = "Archived",
    completed_at: datetime,
    archived_at: datetime | None = None,
    **overrides: Any,
) -> uuid.UUID:
    return _seed_task(
        session_factory,
        title=title,
        status=TaskStatus.DONE,
        completed_at=completed_at,
        archived_at=archived_at if archived_at is not None else completed_at + timedelta(days=7),
        **overrides,
    )


def _all_tasks(session_factory: sessionmaker[Session]) -> list[Task]:
    with session_factory() as session:
        return list(session.execute(select(Task)).scalars().all())


def _fixed_clock(app: FastAPI, now: datetime) -> None:
    app.dependency_overrides[get_current_time] = lambda: now


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value)


# --- List: ordering, hiding active tasks, empty archive ----------------------


def test_list_orders_newest_completion_first_and_hides_active_done(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_archived_task(
        migrated_session_factory, title="March 1", completed_at=datetime(2026, 3, 1, tzinfo=UTC)
    )
    _seed_archived_task(
        migrated_session_factory, title="March 2", completed_at=datetime(2026, 3, 2, tzinfo=UTC)
    )
    _seed_archived_task(
        migrated_session_factory, title="March 3", completed_at=datetime(2026, 3, 3, tzinfo=UTC)
    )
    # An active Done task, well under the seven-day window — never archived.
    _seed_task(
        migrated_session_factory,
        title="Still in Done",
        status=TaskStatus.DONE,
        completed_at=datetime(2026, 9, 26, tzinfo=UTC),
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.get(ARCHIVE_URL)

    response = _run(scenario)

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert [item["title"] for item in body["items"]] == ["March 3", "March 2", "March 1"]
    assert set(body.keys()) == {"items", "total", "page", "page_size"}
    assert set(body["items"][0].keys()) == {
        "id", "title", "content", "status", "category", "priority",
        "deadline_at", "urls", "markdown_note", "position", "created_at",
        "updated_at", "completed_at", "archived_at",
    }


def test_empty_archive_returns_empty_items_and_zero_total(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.get(ARCHIVE_URL)

    response = _run(scenario)

    assert response.status_code == 200
    body = response.json()
    assert body == {"items": [], "total": 0, "page": 1, "page_size": 10}


def test_tie_break_is_archived_at_then_id(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    same_completed = datetime(2026, 3, 1, tzinfo=UTC)
    first_id = _seed_archived_task(
        migrated_session_factory,
        title="Same time A",
        completed_at=same_completed,
        archived_at=datetime(2026, 3, 8, tzinfo=UTC),
    )
    second_id = _seed_archived_task(
        migrated_session_factory,
        title="Same time B",
        completed_at=same_completed,
        archived_at=datetime(2026, 3, 9, tzinfo=UTC),
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.get(ARCHIVE_URL)

    response = _run(scenario)

    assert response.status_code == 200
    ids = [item["id"] for item in response.json()["items"]]
    # Newer `archived_at` first when `completed_at` ties.
    assert ids == [str(second_id), str(first_id)]


# --- Pagination ---------------------------------------------------------------


def test_pagination_covers_every_task_exactly_once(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    base = datetime(2026, 1, 1, tzinfo=UTC)
    for i in range(12):
        _seed_archived_task(
            migrated_session_factory, title=f"task-{i}", completed_at=base + timedelta(hours=i)
        )
    app = app_factory()

    async def scenario() -> list[Response]:
        async with make_client(app) as client:
            await _login(client)
            return [
                await client.get(ARCHIVE_URL, params={"page": 1, "page_size": 5}),
                await client.get(ARCHIVE_URL, params={"page": 2, "page_size": 5}),
                await client.get(ARCHIVE_URL, params={"page": 3, "page_size": 5}),
                await client.get(ARCHIVE_URL, params={"page": 4, "page_size": 5}),
            ]

    responses = _run(scenario)

    for response in responses:
        assert response.status_code == 200
        assert response.json()["total"] == 12

    counts = [len(response.json()["items"]) for response in responses]
    assert counts == [5, 5, 2, 0]

    seen_ids: set[str] = set()
    for response in responses:
        for item in response.json()["items"]:
            assert item["id"] not in seen_ids
            seen_ids.add(item["id"])
    assert len(seen_ids) == 12


@pytest.mark.parametrize(
    "params", [{"page": 0}, {"page": -1}, {"page_size": 0}, {"page_size": 101}]
)
def test_out_of_range_pagination_is_rejected_not_clamped(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    params: dict[str, int],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.get(ARCHIVE_URL, params=params)

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


# --- Search: title only, literal wildcards, trimming, pagination combined ---


def test_search_matches_title_substring_case_insensitively(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_archived_task(
        migrated_session_factory,
        title="Quarterly Report",
        completed_at=datetime(2026, 3, 1, tzinfo=UTC),
    )
    _seed_archived_task(
        migrated_session_factory,
        title="Groceries",
        completed_at=datetime(2026, 3, 2, tzinfo=UTC),
        content="Nothing relevant",
    )
    _seed_archived_task(
        migrated_session_factory,
        title="Groceries",
        completed_at=datetime(2026, 3, 3, tzinfo=UTC),
        content="report on prices",
        markdown_note="report notes",
        urls=[{"url": "https://example.com/report", "label": "report link"}],
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.get(ARCHIVE_URL, params={"search": "REPORT"})

    response = _run(scenario)

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert [item["title"] for item in body["items"]] == ["Quarterly Report"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("content", "unique-content-needle"),
        ("markdown_note", "unique-note-needle"),
    ],
)
def test_search_does_not_match_content_or_notes(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    field: str,
    value: str,
) -> None:
    _seed_archived_task(
        migrated_session_factory,
        title="Untitled",
        completed_at=datetime(2026, 3, 1, tzinfo=UTC),
        **{field: value},
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.get(ARCHIVE_URL, params={"search": "unique"})

    response = _run(scenario)

    assert response.status_code == 200
    assert response.json()["total"] == 0


def test_search_does_not_match_url_or_label(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_archived_task(
        migrated_session_factory,
        title="Untitled",
        completed_at=datetime(2026, 3, 1, tzinfo=UTC),
        urls=[{"url": "https://example.com/unique-path", "label": "unique label"}],
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.get(ARCHIVE_URL, params={"search": "unique"})

    response = _run(scenario)

    assert response.status_code == 200
    assert response.json()["total"] == 0


def test_search_wildcard_characters_are_literal(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_archived_task(
        migrated_session_factory,
        title="Reach 100% coverage",
        completed_at=datetime(2026, 3, 1, tzinfo=UTC),
    )
    _seed_archived_task(
        migrated_session_factory,
        title="Book flights",
        completed_at=datetime(2026, 3, 2, tzinfo=UTC),
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.get(ARCHIVE_URL, params={"search": "100%"})

    response = _run(scenario)

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["title"] == "Reach 100% coverage"


def test_search_is_trimmed_and_blank_means_no_filter(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_archived_task(
        migrated_session_factory, title="Report A", completed_at=datetime(2026, 3, 1, tzinfo=UTC)
    )
    _seed_archived_task(
        migrated_session_factory, title="Other", completed_at=datetime(2026, 3, 2, tzinfo=UTC)
    )
    app = app_factory()

    async def scenario() -> tuple[Response, Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            trimmed = await client.get(ARCHIVE_URL, params={"search": "  Report  "})
            blank = await client.get(ARCHIVE_URL, params={"search": "   "})
            empty = await client.get(ARCHIVE_URL, params={"search": ""})
            return trimmed, blank, empty

    trimmed, blank, empty = _run(scenario)

    assert trimmed.status_code == 200
    assert trimmed.json()["total"] == 1
    assert trimmed.json()["items"][0]["title"] == "Report A"

    assert blank.status_code == 200
    assert blank.json()["total"] == 2

    assert empty.status_code == 200
    assert empty.json()["total"] == 2


def test_search_combines_with_pagination(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    base = datetime(2026, 1, 1, tzinfo=UTC)
    for i in range(7):
        _seed_archived_task(
            migrated_session_factory,
            title=f"Match {i}",
            completed_at=base + timedelta(hours=i),
        )
    _seed_archived_task(
        migrated_session_factory, title="No hit", completed_at=base + timedelta(hours=8)
    )
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            page_one = await client.get(
                ARCHIVE_URL, params={"search": "Match", "page": 1, "page_size": 5}
            )
            page_two = await client.get(
                ARCHIVE_URL, params={"search": "Match", "page": 2, "page_size": 5}
            )
            return page_one, page_two

    page_one, page_two = _run(scenario)

    assert page_one.json()["total"] == 7
    assert page_two.json()["total"] == 7
    assert len(page_one.json()["items"]) == 5
    assert len(page_two.json()["items"]) == 2
    titles = [i["title"] for i in page_one.json()["items"] + page_two.json()["items"]]
    assert titles == ["Match 6", "Match 5", "Match 4", "Match 3", "Match 2", "Match 1", "Match 0"]


# --- Read one archived task ---------------------------------------------------


def test_get_archived_task_returns_full_task_response(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_archived_task(
        migrated_session_factory, title="Read me", completed_at=datetime(2026, 3, 1, tzinfo=UTC)
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.get(f"{ARCHIVE_URL}/{task_id}")

    response = _run(scenario)

    assert response.status_code == 200
    assert response.json()["id"] == str(task_id)
    assert response.json()["title"] == "Read me"


def test_get_archived_task_404_for_unknown_and_active(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    active_id = _seed_task(migrated_session_factory, title="Active")
    unknown_id = uuid.uuid4()
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            return (
                await client.get(f"{ARCHIVE_URL}/{active_id}"),
                await client.get(f"{ARCHIVE_URL}/{unknown_id}"),
            )

    active_response, unknown_response = _run(scenario)

    assert active_response.status_code == 404
    assert active_response.json()["code"] == "NOT_FOUND"
    assert unknown_response.status_code == 404
    assert unknown_response.json()["code"] == "NOT_FOUND"


# --- Restore -------------------------------------------------------------------


def test_restore_returns_task_to_todo_and_appends_last(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_a = _seed_task(migrated_session_factory, title="A", position=1.0)
    task_b = _seed_task(migrated_session_factory, title="B", position=2.0)
    task_c = _seed_archived_task(
        migrated_session_factory, title="C", completed_at=datetime(2026, 3, 1, tzinfo=UTC)
    )
    app = app_factory()
    now = datetime(2026, 9, 27, 12, 0, 0, tzinfo=UTC)
    _fixed_clock(app, now)

    async def scenario() -> tuple[Response, Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            restore_response = await client.post(f"{ARCHIVE_URL}/{task_c}/restore")
            tasks_response = await client.get(TASKS_URL)
            archive_response = await client.get(ARCHIVE_URL)
            return restore_response, tasks_response, archive_response

    restore_response, tasks_response, archive_response = _run(scenario)

    assert restore_response.status_code == 200
    restored = restore_response.json()
    assert restored["status"] == "todo"
    assert restored["completed_at"] is None
    assert restored["archived_at"] is None
    assert _parse(restored["updated_at"]) == now
    # spec §9.1's seven-day timer needs `completed_at`; restoring clears it,
    # so the restored task is never immediately re-eligible for archiving.
    assert is_eligible_for_archive(restored["status"], restored["completed_at"], now) is False

    todo_titles = [t["title"] for t in tasks_response.json() if t["status"] == "todo"]
    assert todo_titles == ["A", "B", "C"]

    stored = {t.id: t.position for t in _all_tasks(migrated_session_factory)}
    assert stored[task_a] == 1.0
    assert stored[task_b] == 2.0
    assert stored[task_c] > 2.0

    assert archive_response.json()["total"] == 0


def test_restore_into_empty_todo_column_succeeds(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_archived_task(
        migrated_session_factory, title="Solo", completed_at=datetime(2026, 3, 1, tzinfo=UTC)
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(f"{ARCHIVE_URL}/{task_id}/restore")

    response = _run(scenario)

    assert response.status_code == 200
    assert response.json()["status"] == "todo"


def test_restore_renumbers_the_column_when_appending_would_overflow(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    """The Todo column's last position sits at `domain.ordering`'s maximum
    representable value, so appending one more can't add a distinct `+1` —
    `ordering.move_to_column` falls back to renumbering every slot, which
    means an *existing* Todo task's position changes too, not just the
    restored task's. Exercises the branch in `restore_task` that writes a
    changed position back onto another column member."""
    edge_id = _seed_task(
        migrated_session_factory, title="Edge", position=2.0**53
    )
    task_id = _seed_archived_task(
        migrated_session_factory, title="Restored", completed_at=datetime(2026, 3, 1, tzinfo=UTC)
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(f"{ARCHIVE_URL}/{task_id}/restore")

    response = _run(scenario)

    assert response.status_code == 200
    stored = {t.id: t.position for t in _all_tasks(migrated_session_factory)}
    assert stored[edge_id] != 2.0**53
    assert stored[task_id] > stored[edge_id]


def test_restore_is_readable_via_tasks_endpoint(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_archived_task(
        migrated_session_factory, title="Now active", completed_at=datetime(2026, 3, 1, tzinfo=UTC)
    )
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            restore_response = await client.post(f"{ARCHIVE_URL}/{task_id}/restore")
            get_response = await client.get(f"{TASKS_URL}/{task_id}")
            return restore_response, get_response

    restore_response, get_response = _run(scenario)

    assert restore_response.status_code == 200
    assert get_response.status_code == 200
    assert get_response.json()["id"] == str(task_id)


def test_restore_unknown_or_active_task_returns_404_and_changes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    active_id = _seed_task(migrated_session_factory, title="Active", position=1.0)
    unknown_id = uuid.uuid4()
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            return (
                await client.post(f"{ARCHIVE_URL}/{active_id}/restore"),
                await client.post(f"{ARCHIVE_URL}/{unknown_id}/restore"),
            )

    active_response, unknown_response = _run(scenario)

    assert active_response.status_code == 404
    assert active_response.json()["code"] == "NOT_FOUND"
    assert unknown_response.status_code == 404
    assert unknown_response.json()["code"] == "NOT_FOUND"

    stored = _all_tasks(migrated_session_factory)
    assert len(stored) == 1
    assert stored[0].title == "Active"
    assert stored[0].position == 1.0


# --- Permanent delete -----------------------------------------------------------


def test_permanent_delete_removes_row(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_archived_task(
        migrated_session_factory, title="Gone soon", completed_at=datetime(2026, 3, 1, tzinfo=UTC)
    )
    app = app_factory()

    async def scenario() -> tuple[Response, Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            delete_response = await client.delete(f"{ARCHIVE_URL}/{task_id}")
            get_response = await client.get(f"{ARCHIVE_URL}/{task_id}")
            list_response = await client.get(ARCHIVE_URL)
            return delete_response, get_response, list_response

    delete_response, get_response, list_response = _run(scenario)

    assert delete_response.status_code == 204
    assert delete_response.content == b""
    assert get_response.status_code == 404
    assert list_response.json()["total"] == 0
    assert _all_tasks(migrated_session_factory) == []


def test_delete_active_task_via_archive_returns_404_and_leaves_it_untouched(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    active_id = _seed_task(migrated_session_factory, title="Board task")
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.delete(f"{ARCHIVE_URL}/{active_id}")

    response = _run(scenario)

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"
    stored = _all_tasks(migrated_session_factory)
    assert len(stored) == 1
    assert stored[0].id == active_id


def test_delete_unknown_id_returns_404(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    unknown_id = uuid.uuid4()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.delete(f"{ARCHIVE_URL}/{unknown_id}")

    response = _run(scenario)

    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


# --- Security and malformed id --------------------------------------------------


def test_unauthenticated_requests_return_401(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_archived_task(
        migrated_session_factory, completed_at=datetime(2026, 3, 1, tzinfo=UTC)
    )
    app = app_factory()

    async def scenario() -> list[Response]:
        async with make_client(app) as client:
            return [
                await client.get(ARCHIVE_URL),
                await client.get(f"{ARCHIVE_URL}/{task_id}"),
                await client.post(f"{ARCHIVE_URL}/{task_id}/restore"),
                await client.delete(f"{ARCHIVE_URL}/{task_id}"),
            ]

    responses = _run(scenario)

    for response in responses:
        assert response.status_code == 401
        assert response.json()["code"] == "NOT_AUTHENTICATED"

    stored = _all_tasks(migrated_session_factory)
    assert len(stored) == 1
    assert stored[0].archived_at is not None


def test_cross_origin_writes_return_403_and_change_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    task_id = _seed_archived_task(
        migrated_session_factory, completed_at=datetime(2026, 3, 1, tzinfo=UTC)
    )
    app = app_factory()

    async def scenario() -> list[Response]:
        async with make_client(app) as client:
            await _login(client)
            foreign = {"Origin": FOREIGN_ORIGIN}
            return [
                await client.post(f"{ARCHIVE_URL}/{task_id}/restore", headers=foreign),
                await client.delete(f"{ARCHIVE_URL}/{task_id}", headers=foreign),
            ]

    responses = _run(scenario)

    for response in responses:
        assert response.status_code == 403
        assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"

    stored = _all_tasks(migrated_session_factory)
    assert len(stored) == 1
    assert stored[0].archived_at is not None


@pytest.mark.parametrize("method", ["get", "post", "delete"])
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
            await _login(client)
            if method == "post":
                return await client.post(f"{ARCHIVE_URL}/not-a-uuid/restore")
            request = getattr(client, method)
            return await request(f"{ARCHIVE_URL}/not-a-uuid")

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


# --- OpenAPI documentation -------------------------------------------------------


def test_openapi_documents_all_operations_and_error_envelopes(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()
    schema = app.openapi()
    paths = schema["paths"]

    def _refs_error_response(responses: dict[str, Any], status: str) -> bool:
        ref = responses[status]["content"]["application/json"]["schema"].get("$ref", "")
        return ref.endswith("/ErrorResponse")

    list_op = paths[ARCHIVE_URL]["get"]["responses"]
    assert _refs_error_response(list_op, "401")
    assert _refs_error_response(list_op, "422")
    list_schema_ref = list_op["200"]["content"]["application/json"]["schema"]["$ref"]
    assert list_schema_ref.endswith("/ArchiveListResponse")

    item_op = paths[f"{ARCHIVE_URL}/{{task_id}}"]["get"]["responses"]
    assert _refs_error_response(item_op, "401")
    assert _refs_error_response(item_op, "404")
    assert _refs_error_response(item_op, "422")

    restore_op = paths[f"{ARCHIVE_URL}/{{task_id}}/restore"]["post"]["responses"]
    assert _refs_error_response(restore_op, "401")
    assert _refs_error_response(restore_op, "403")
    assert _refs_error_response(restore_op, "404")
    assert _refs_error_response(restore_op, "422")

    delete_op = paths[f"{ARCHIVE_URL}/{{task_id}}"]["delete"]["responses"]
    assert _refs_error_response(delete_op, "401")
    assert _refs_error_response(delete_op, "403")
    assert _refs_error_response(delete_op, "404")
    assert _refs_error_response(delete_op, "422")
    assert "204" in delete_op

    archive_list_schema = schema["components"]["schemas"]["ArchiveListResponse"]
    assert set(archive_list_schema["properties"].keys()) == {
        "items", "total", "page", "page_size",
    }


# --- Performance target (spec §15.2) --------------------------------------------


def test_search_over_ten_thousand_archived_tasks_is_fast(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    base = datetime(2020, 1, 1, tzinfo=UTC)
    rows = []
    for i in range(10_000):
        completed_at = base + timedelta(minutes=i)
        title = "Findme target task" if i % 500 == 0 else f"Filler task {i}"
        rows.append(
            {
                "id": uuid.uuid4(),
                "title": title,
                "content": "content",
                "status": TaskStatus.DONE,
                "category": TaskCategory.OTHER,
                "priority": TaskPriority.MEDIUM,
                "urls": [],
                "markdown_note": "",
                "position": float(i + 1),
                "created_at": completed_at,
                "updated_at": completed_at,
                "completed_at": completed_at,
                "archived_at": completed_at + timedelta(days=7),
            }
        )
    with migrated_session_factory() as session:
        session.execute(insert(Task), rows)
        session.commit()

    app = app_factory()

    async def timed_scenario() -> tuple[Response, float]:
        async with make_client(app) as client:
            await _login(client)
            started = time.perf_counter()
            response = await client.get(ARCHIVE_URL, params={"search": "target"})
            elapsed = time.perf_counter() - started
            return response, elapsed

    response, elapsed_seconds = _run(timed_scenario)

    assert response.status_code == 200
    assert response.json()["total"] == 20
    elapsed_ms = elapsed_seconds * 1000
    assert elapsed_ms < 500, f"search over 10,000 archived tasks took {elapsed_ms:.1f} ms"
