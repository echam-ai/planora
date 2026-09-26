"""Regression tests for `api.deps.get_db`'s transaction contract (issue
#25).

Two properties, both PM/tester-reported:

1. A write made through `get_db` must roll back when the route raises
   *any* exception afterward — including an intentional `ApiError` for an
   unrelated business-rule failure, not just an unexpected crash.
2. `get_db`'s own commit must complete *before* the response is sent, and
   a failure there must turn into an error response rather than a 2xx the
   client already received. In the FastAPI version pinned here (0.141.1),
   a `yield` dependency defaults to request scope, whose post-yield code
   runs *after* the response has gone out — so a failing commit there
   can't affect the status code, and for login, a `Set-Cookie` for a
   session that was never actually saved would already be on the wire.
   `Depends(get_db, scope="function")` (used throughout `api/v1/auth.py`
   and inside `get_current_session`) runs the commit before the response
   is produced instead. See `get_db`'s and `get_session_factory`'s
   docstrings in `api/deps.py` for the full contract #28-#31 inherit.

Every route #28-#31 build on `require_session`/`get_db` depends on both of
these; this file mounts throwaway routes on a real app instance rather
than testing them incidentally through a specific endpoint.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Annotated, Any

import pytest
from conftest import AUTH_PASSWORD, AUTH_USERNAME
from fastapi import APIRouter, Depends, FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.api.deps import get_db
from planora_api.db.models import LoginFailure
from planora_api.errors import ApiError

_MARKER_IP = "203.0.113.99"  # distinctive so this test can't collide with others

_test_router = APIRouter()


@_test_router.post("/api/v1/__test_only/write_then_error")
def _write_then_error(db: Annotated[Session, Depends(get_db, scope="function")]) -> None:
    db.add(LoginFailure(client_ip=_MARKER_IP, failed_at=datetime(2026, 1, 1, tzinfo=UTC)))
    db.flush()
    # An unrelated business-rule failure — nothing to do with the write
    # above, and nothing to do with the rate limiter's own intentional
    # short-transaction commit.
    raise ApiError(400, "TEST_ERROR", "an unrelated failure after a write")


@_test_router.post("/api/v1/__test_only/write_normally")
def _write_normally(db: Annotated[Session, Depends(get_db, scope="function")]) -> dict[str, bool]:
    # No exception raised here — if this still comes back as an error, it
    # can only be because the commit itself (inside `get_db`, after this
    # function returns) failed.
    db.add(LoginFailure(client_ip=_MARKER_IP, failed_at=datetime(2026, 1, 1, tzinfo=UTC)))
    return {"ok": True}


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


def test_get_db_rolls_back_a_write_when_the_route_raises_api_error(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    app.include_router(_test_router)

    async def scenario() -> Response:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as client:
            return await client.post("/api/v1/__test_only/write_then_error")

    response = _run(scenario)

    assert response.status_code == 400
    assert response.json() == {"code": "TEST_ERROR", "message": "an unrelated failure after a write"}

    with migrated_session_factory() as session:
        rows = (
            session.execute(select(LoginFailure).where(LoginFailure.client_ip == _MARKER_IP))
            .scalars()
            .all()
        )
    assert rows == []  # the write did not survive the ApiError


def test_a_failing_commit_returns_an_error_status_not_2xx(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The route itself raises nothing and returns a normal 200 body; the
    # only thing that can fail here is `get_db`'s own post-yield commit.
    app = app_factory()
    app.include_router(_test_router)

    def failing_commit(self: Session) -> None:
        raise RuntimeError("commit failed (simulated)")

    monkeypatch.setattr(Session, "commit", failing_commit)

    async def scenario() -> Response:
        # `raise_app_exceptions=False`: an *unhandled* exception (this
        # RuntimeError has no registered handler, unlike `ApiError`) would
        # otherwise propagate into the test instead of becoming the 500
        # response we want to inspect — Starlette's own error middleware
        # still sends that response before re-raising for a caller that
        # wants the traceback, which is what the default `True` is for.
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="https://test") as client:
            return await client.post("/api/v1/__test_only/write_normally")

    response = _run(scenario)

    # Not 2xx: the failing commit must surface as an error, which it can
    # only do if it runs *before* the response is sent — proving
    # `scope="function"` is actually taking effect in this FastAPI build.
    assert not (200 <= response.status_code < 300)


def test_login_sends_no_set_cookie_when_its_final_commit_fails(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A successful login commits `db` twice: once mid-request (releasing
    # its transaction before the rate limiter's independent connection —
    # see `get_session_factory`'s docstring), and once more by `get_db`
    # itself after the route returns. Let the first commit on each session
    # instance succeed (so the login logic proceeds normally, including
    # setting the cookie on the response object) and fail only the
    # second — which is `get_db`'s own, the one this test targets.
    app = app_factory()
    commit_counts: dict[int, int] = {}
    real_commit = Session.commit

    def flaky_commit(self: Session) -> None:
        key = id(self)
        commit_counts[key] = commit_counts.get(key, 0) + 1
        if commit_counts[key] >= 2:
            raise RuntimeError("commit failed (simulated)")
        real_commit(self)

    monkeypatch.setattr(Session, "commit", flaky_commit)

    async def scenario() -> Response:
        # See the sibling test above for why `raise_app_exceptions=False`
        # is needed here too.
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(transport=transport, base_url="https://test") as client:
            return await client.post(
                "/api/v1/auth/login",
                json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD},
            )

    response = _run(scenario)

    assert not (200 <= response.status_code < 300)
    assert "set-cookie" not in response.headers
