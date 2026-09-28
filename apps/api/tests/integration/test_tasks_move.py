"""Integration tests for `/api/v1/tasks/{id}/move` and `/api/v1/tasks/reorder`
(issue #29, spec §5, §7.1, §9.1, §15.1).

Reuses the login, seed, fixed-clock and comparison helpers from #28's
`test_tasks_crud.py` rather than duplicating them — same HTTPX
`AsyncClient`-against-the-real-ASGI-app approach, same `migrated_session_factory`
disposable-SQLite-file fixture.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime

import pytest
from conftest import make_client
from fastapi import FastAPI
from httpx import Response
from sqlalchemy.orm import Session, sessionmaker

from integration.test_tasks_crud import (
    FOREIGN_ORIGIN,
    TASKS_URL,
    _all_tasks,
    _fixed_clock,
    _login,
    _parse,
    _run,
    _seed_task,
)
from planora_api.db.models import Task, TaskStatus


def _titles_in_status(
    session_factory: sessionmaker[Session], status: TaskStatus
) -> list[str]:
    tasks = sorted(
        (
            t for t in _all_tasks(session_factory)
            if t.status == status and t.archived_at is None
        ),
        key=lambda t: t.position,
    )
    return [t.title for t in tasks]


def _by_title(session_factory: sessionmaker[Session]) -> dict[str, Task]:
    return {t.title: t for t in _all_tasks(session_factory)}


# --- Cross-column move: contract scenarios ------------------------------------


def test_move_into_another_column_at_an_index(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0)
    _seed_task(migrated_session_factory, title="B", status=TaskStatus.TODO, position=2.0)
    _seed_task(migrated_session_factory, title="E", status=TaskStatus.TODO, position=3.0)
    _seed_task(migrated_session_factory, title="C", status=TaskStatus.IN_PROGRESS, position=1.0)
    _seed_task(migrated_session_factory, title="D", status=TaskStatus.IN_PROGRESS, position=2.0)
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            move_response = await client.post(
                f"{TASKS_URL}/{a}/move", json={"status": "in_progress", "index": 1}
            )
            list_response = await client.get(TASKS_URL)
            return move_response, list_response

    move_response, list_response = _run(scenario)

    assert move_response.status_code == 200
    assert list_response.status_code == 200
    assert move_response.json() == list_response.json()

    assert _titles_in_status(migrated_session_factory, TaskStatus.IN_PROGRESS) == [
        "C", "A", "D",
    ]
    # The source column's remaining tasks keep their previous relative order.
    assert _titles_in_status(migrated_session_factory, TaskStatus.TODO) == ["B", "E"]


def test_move_to_the_end_of_another_column_and_rejects_an_index_past_the_end(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0)
    e = _seed_task(migrated_session_factory, title="E", status=TaskStatus.TODO, position=2.0)
    _seed_task(migrated_session_factory, title="C", status=TaskStatus.IN_PROGRESS, position=1.0)
    _seed_task(migrated_session_factory, title="D", status=TaskStatus.IN_PROGRESS, position=2.0)
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            ok = await client.post(
                f"{TASKS_URL}/{a}/move", json={"status": "in_progress", "index": 2}
            )
            # E is a separate task, still in Todo — this keeps the second
            # request a fresh cross-column move (not a within-Done-column
            # same-status reorder like the first request has now become),
            # so an out-of-range index here still exercises
            # `domain.ordering.move_to_column`'s `ValueError`, not
            # `reorder_within_column`'s.
            too_far = await client.post(
                f"{TASKS_URL}/{e}/move", json={"status": "in_progress", "index": 4}
            )
            return ok, too_far

    ok, too_far = _run(scenario)

    assert ok.status_code == 200
    assert _titles_in_status(migrated_session_factory, TaskStatus.IN_PROGRESS) == [
        "C", "D", "A",
    ]

    assert too_far.status_code == 422
    assert too_far.json()["code"] == "VALIDATION_ERROR"
    # Nothing changed from the state `ok` already produced.
    assert _titles_in_status(migrated_session_factory, TaskStatus.IN_PROGRESS) == [
        "C", "D", "A",
    ]
    assert _titles_in_status(migrated_session_factory, TaskStatus.TODO) == ["E"]


def test_reorder_persists_across_a_fresh_login(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0)
    b = _seed_task(migrated_session_factory, title="B", status=TaskStatus.TODO, position=2.0)
    c = _seed_task(migrated_session_factory, title="C", status=TaskStatus.TODO, position=3.0)
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as first_client:
            await _login(first_client)
            reorder_response = await first_client.post(
                f"{TASKS_URL}/reorder",
                json={"status": "todo", "ordered_ids": [str(c), str(a), str(b)]},
            )
        async with make_client(app) as second_client:
            await _login(second_client)
            list_response = await second_client.get(TASKS_URL)
        return reorder_response, list_response

    reorder_response, list_response = _run(scenario)

    assert reorder_response.status_code == 200
    assert list_response.status_code == 200
    assert [t["title"] for t in reorder_response.json()] == ["C", "A", "B"]
    assert [t["title"] for t in list_response.json()] == ["C", "A", "B"]


def test_task_completes_when_dragged_into_done_at_a_fixed_clock(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO)
    app = app_factory()
    t = datetime(2026, 9, 27, 10, 0, 0, tzinfo=UTC)
    _fixed_clock(app, t)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(
                f"{TASKS_URL}/{a}/move", json={"status": "done", "index": 0}
            )

    response = _run(scenario)

    assert response.status_code == 200
    moved = next(t for t in response.json() if t["id"] == str(a))
    assert _parse(moved["completed_at"]) == t
    assert moved["status"] == "done"
    assert _parse(moved["updated_at"]) == t


def test_task_clears_completed_at_when_dragged_out_of_done(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    t0 = datetime(2026, 9, 20, 8, 0, 0, tzinfo=UTC)
    a = _seed_task(
        migrated_session_factory, title="A", status=TaskStatus.DONE, completed_at=t0
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(
                f"{TASKS_URL}/{a}/move", json={"status": "todo", "index": 0}
            )

    response = _run(scenario)

    assert response.status_code == 200
    moved = next(t for t in response.json() if t["id"] == str(a))
    assert moved["completed_at"] is None
    assert moved["status"] == "todo"


def test_reordering_done_column_leaves_completed_at_unchanged(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    t1 = datetime(2026, 9, 20, 8, 0, 0, tzinfo=UTC)
    t2 = datetime(2026, 9, 21, 8, 0, 0, tzinfo=UTC)
    a = _seed_task(
        migrated_session_factory,
        title="A", status=TaskStatus.DONE, position=1.0, completed_at=t1,
    )
    b = _seed_task(
        migrated_session_factory,
        title="B", status=TaskStatus.DONE, position=2.0, completed_at=t2,
    )
    app = app_factory()
    later = datetime(2026, 9, 27, 9, 0, 0, tzinfo=UTC)
    _fixed_clock(app, later)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(
                f"{TASKS_URL}/reorder",
                json={"status": "done", "ordered_ids": [str(b), str(a)]},
            )

    response = _run(scenario)

    assert response.status_code == 200
    stored = _by_title(migrated_session_factory)
    assert stored["A"].completed_at == t1
    assert stored["B"].completed_at == t2


def test_same_status_move_within_done_does_not_reset_the_timer(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    t1 = datetime(2026, 9, 20, 8, 0, 0, tzinfo=UTC)
    a = _seed_task(
        migrated_session_factory,
        title="A", status=TaskStatus.DONE, position=1.0, completed_at=t1,
    )
    _seed_task(migrated_session_factory, title="B", status=TaskStatus.DONE, position=2.0)
    app = app_factory()
    later = datetime(2026, 9, 27, 9, 0, 0, tzinfo=UTC)
    _fixed_clock(app, later)

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(
                f"{TASKS_URL}/{a}/move", json={"status": "done", "index": 1}
            )

    response = _run(scenario)

    assert response.status_code == 200
    stored = _by_title(migrated_session_factory)
    assert stored["A"].completed_at == t1


def test_ai_move_to_top_of_current_column_changes_no_status_or_completed_at(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0)
    _seed_task(migrated_session_factory, title="B", status=TaskStatus.TODO, position=2.0)
    c = _seed_task(migrated_session_factory, title="C", status=TaskStatus.TODO, position=3.0)
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(
                f"{TASKS_URL}/{c}/move", json={"status": "todo", "index": 0}
            )

    response = _run(scenario)

    assert response.status_code == 200
    assert [t["title"] for t in response.json()] == ["C", "A", "B"]
    moved = next(t for t in response.json() if t["id"] == str(c))
    assert moved["status"] == "todo"
    assert moved["completed_at"] is None


# --- Reorder: same order is a no-op -------------------------------------------


def test_reorder_to_the_current_order_changes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    updated_at = datetime(2026, 9, 1, tzinfo=UTC)
    a = _seed_task(
        migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0,
        updated_at=updated_at,
    )
    b = _seed_task(
        migrated_session_factory, title="B", status=TaskStatus.TODO, position=2.0,
        updated_at=updated_at,
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(
                f"{TASKS_URL}/reorder",
                json={"status": "todo", "ordered_ids": [str(a), str(b)]},
            )

    response = _run(scenario)

    assert response.status_code == 200
    stored = _by_title(migrated_session_factory)
    assert stored["A"].position == 1.0
    assert stored["B"].position == 2.0
    assert stored["A"].updated_at == updated_at
    assert stored["B"].updated_at == updated_at


# --- Move: not found, out-of-range index, invalid status ----------------------


def test_move_unknown_or_archived_id_returns_404_and_writes_nothing(
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

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            unknown = await client.post(
                f"{TASKS_URL}/{unknown_id}/move", json={"status": "todo", "index": 0}
            )
            archived = await client.post(
                f"{TASKS_URL}/{archived_id}/move", json={"status": "todo", "index": 0}
            )
            return unknown, archived

    unknown_response, archived_response = _run(scenario)

    assert unknown_response.status_code == 404
    assert unknown_response.json()["code"] == "NOT_FOUND"
    assert archived_response.status_code == 404
    assert archived_response.json()["code"] == "NOT_FOUND"


def test_move_negative_index_is_rejected_and_never_clamped(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0)
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(
                f"{TASKS_URL}/{a}/move", json={"status": "todo", "index": -1}
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert _all_tasks(migrated_session_factory)[0].position == 1.0


def test_move_within_column_index_above_last_slot_is_rejected(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    """A same-status move's `index` is bounded by its own column's size,
    checked by `domain.ordering.reorder_within_column` — distinct from a
    negative index, which the wire schema rejects before this is reached."""
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0)
    _seed_task(migrated_session_factory, title="B", status=TaskStatus.TODO, position=2.0)
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(
                f"{TASKS_URL}/{a}/move", json={"status": "todo", "index": 2}
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert _titles_in_status(migrated_session_factory, TaskStatus.TODO) == ["A", "B"]


@pytest.mark.parametrize("bad_status", ["archived", "Todo", "DONE"])
def test_move_and_reorder_reject_an_invalid_status_enum(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    bad_status: str,
) -> None:
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO)
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            move = await client.post(
                f"{TASKS_URL}/{a}/move", json={"status": bad_status, "index": 0}
            )
            reorder = await client.post(
                f"{TASKS_URL}/reorder",
                json={"status": bad_status, "ordered_ids": [str(a)]},
            )
            return move, reorder

    move_response, reorder_response = _run(scenario)

    assert move_response.status_code == 422
    assert move_response.json()["code"] == "VALIDATION_ERROR"
    assert reorder_response.status_code == 422
    assert reorder_response.json()["code"] == "VALIDATION_ERROR"


# --- Reorder: stale/incomplete input -------------------------------------------


@pytest.mark.parametrize(
    "ordered_ids_fn",
    [
        lambda a, b, c, done, archived: [str(b), str(a)],  # missing C
        lambda a, b, c, done, archived: [str(a), str(a), str(b), str(c)],  # duplicate A
        lambda a, b, c, done, archived: [str(a), str(b), str(done)],  # foreign column's id
        lambda a, b, c, done, archived: [str(a), str(b), str(uuid.uuid4())],  # unknown id
        lambda a, b, c, done, archived: [str(a), str(b), str(archived)],  # archived task's id
    ],
)
def test_stale_or_invalid_reorder_input_is_rejected_and_writes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    ordered_ids_fn: Callable[..., list[str]],
) -> None:
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0)
    b = _seed_task(migrated_session_factory, title="B", status=TaskStatus.TODO, position=2.0)
    c = _seed_task(migrated_session_factory, title="C", status=TaskStatus.TODO, position=3.0)
    done = _seed_task(migrated_session_factory, title="Done", status=TaskStatus.DONE, position=1.0)
    archived = _seed_task(
        migrated_session_factory,
        title="Archived",
        status=TaskStatus.TODO,
        archived_at=datetime(2026, 9, 1, tzinfo=UTC),
    )
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(
                f"{TASKS_URL}/reorder",
                json={
                    "status": "todo",
                    "ordered_ids": ordered_ids_fn(a, b, c, done, archived),
                },
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    assert _titles_in_status(migrated_session_factory, TaskStatus.TODO) == ["A", "B", "C"]


# --- Auth and CSRF -------------------------------------------------------------


def test_unauthenticated_move_and_reorder_return_401_and_write_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0)
    app = app_factory()

    async def scenario() -> list[Response]:
        async with make_client(app) as client:
            return [
                await client.post(
                    f"{TASKS_URL}/{a}/move", json={"status": "done", "index": 0}
                ),
                await client.post(
                    f"{TASKS_URL}/reorder",
                    json={"status": "todo", "ordered_ids": [str(a)]},
                ),
            ]

    responses = _run(scenario)

    for response in responses:
        assert response.status_code == 401
        assert response.json()["code"] == "NOT_AUTHENTICATED"

    stored = _all_tasks(migrated_session_factory)[0]
    assert stored.status == TaskStatus.TODO
    assert stored.position == 1.0


def test_cross_origin_move_and_reorder_return_403_and_write_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0)
    app = app_factory()

    async def scenario() -> list[Response]:
        async with make_client(app) as client:
            await _login(client)
            foreign = {"Origin": FOREIGN_ORIGIN}
            return [
                await client.post(
                    f"{TASKS_URL}/{a}/move",
                    json={"status": "done", "index": 0},
                    headers=foreign,
                ),
                await client.post(
                    f"{TASKS_URL}/reorder",
                    json={"status": "todo", "ordered_ids": [str(a)]},
                    headers=foreign,
                ),
            ]

    responses = _run(scenario)

    for response in responses:
        assert response.status_code == 403
        assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"

    stored = _all_tasks(migrated_session_factory)[0]
    assert stored.status == TaskStatus.TODO
    assert stored.position == 1.0


# --- Transactional commit ------------------------------------------------------


def test_a_failed_commit_mid_move_leaves_every_row_unchanged(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0)
    _seed_task(migrated_session_factory, title="X", status=TaskStatus.IN_PROGRESS, position=1.0)
    _seed_task(migrated_session_factory, title="Y", status=TaskStatus.IN_PROGRESS, position=2.0)
    app = app_factory()
    before = {t.title: (t.status, t.position, t.completed_at) for t in _all_tasks(migrated_session_factory)}

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)

            original_commit = Session.commit

            def failing_commit(self: Session) -> None:
                raise RuntimeError("simulated commit failure")

            Session.commit = failing_commit  # type: ignore[method-assign]
            try:
                return await client.post(
                    f"{TASKS_URL}/{a}/move",
                    json={"status": "in_progress", "index": 1},
                )
            finally:
                Session.commit = original_commit  # type: ignore[method-assign]

    response = _run(scenario)

    assert not (200 <= response.status_code < 300)
    after = {t.title: (t.status, t.position, t.completed_at) for t in _all_tasks(migrated_session_factory)}
    assert after == before


def test_a_failed_commit_mid_reorder_leaves_every_row_unchanged(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    a = _seed_task(migrated_session_factory, title="A", status=TaskStatus.TODO, position=1.0)
    _seed_task(migrated_session_factory, title="B", status=TaskStatus.TODO, position=2.0)
    c = _seed_task(migrated_session_factory, title="C", status=TaskStatus.TODO, position=3.0)
    app = app_factory()
    before = {t.title: (t.status, t.position, t.completed_at) for t in _all_tasks(migrated_session_factory)}

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)

            original_commit = Session.commit

            def failing_commit(self: Session) -> None:
                raise RuntimeError("simulated commit failure")

            Session.commit = failing_commit  # type: ignore[method-assign]
            try:
                return await client.post(
                    f"{TASKS_URL}/reorder",
                    json={"status": "todo", "ordered_ids": [str(c), str(a)] + [
                        str(t.id) for t in _all_tasks(migrated_session_factory)
                        if t.status == TaskStatus.TODO and t.id not in (a, c)
                    ]},
                )
            finally:
                Session.commit = original_commit  # type: ignore[method-assign]

    response = _run(scenario)

    assert not (200 <= response.status_code < 300)
    after = {t.title: (t.status, t.position, t.completed_at) for t in _all_tasks(migrated_session_factory)}
    assert after == before


# --- OpenAPI documentation ------------------------------------------------------


def test_openapi_documents_move_and_reorder(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()
    schema = app.openapi()
    paths = schema["paths"]

    def _refs_error_response(responses: dict, status: str) -> bool:
        ref = responses[status]["content"]["application/json"]["schema"].get("$ref", "")
        return ref.endswith("/ErrorResponse")

    def _returns_task_array(responses: dict) -> bool:
        schema_200 = responses["200"]["content"]["application/json"]["schema"]
        return schema_200.get("type") == "array"

    move = paths["/api/v1/tasks/{task_id}/move"]["post"]["responses"]
    assert _returns_task_array(move)
    assert _refs_error_response(move, "401")
    assert _refs_error_response(move, "403")
    assert _refs_error_response(move, "422")
    assert "404" in move

    reorder = paths["/api/v1/tasks/reorder"]["post"]["responses"]
    assert _returns_task_array(reorder)
    assert _refs_error_response(reorder, "401")
    assert _refs_error_response(reorder, "403")
    assert _refs_error_response(reorder, "422")
