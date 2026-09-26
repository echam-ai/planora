"""Integration tests for `GET /api/v1/auth/session`, `POST
/api/v1/auth/logout` and the `require_session` dependency (issue #25).

Session expiry is simulated with `app.dependency_overrides[get_current_time]`
rather than waiting 14 real days.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import pytest
from conftest import AUTH_PASSWORD, AUTH_USERNAME, make_client
from fastapi import APIRouter, Depends, FastAPI
from httpx import AsyncClient, Response

from planora_api.api.deps import get_current_time, require_session
from planora_api.db.models import AuthSession


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _login(client: AsyncClient) -> Response:
    return await client.post(
        "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD}
    )


def test_session_read_with_valid_cookie_matches_login_response(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            login_response = await _login(client)
            session_response = await client.get("/api/v1/auth/session")
            return login_response, session_response

    login_response, session_response = _run(scenario)

    assert session_response.status_code == 200
    assert session_response.json() == login_response.json()


def test_session_read_returns_null_when_the_account_no_longer_exists(
    valid_env: pytest.MonkeyPatch, migrated_session_factory: object,
    app_factory: Callable[[], FastAPI],
) -> None:
    # A valid, unexpired session row with no matching `app_user` row isn't
    # reachable through #25's own endpoints (login requires a user to
    # create one), but `read_session` must not trust the session alone —
    # build the row directly through `security.session` instead.
    from planora_api.config import load_settings
    from planora_api.security.session import create_session

    settings = load_settings()
    with migrated_session_factory() as session:
        token, _row = create_session(session, settings.session_secret, datetime.now(UTC))
        session.commit()

    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            client.cookies.set("planora_session", token)
            return await client.get("/api/v1/auth/session")

    response = _run(scenario)
    assert response.status_code == 200
    assert response.json() is None


@pytest.mark.parametrize(
    "cookies",
    [
        {},  # no cookie
        {"planora_session": "not-a-real-token-at-all"},  # garbage cookie
    ],
)
def test_session_read_returns_null_for_missing_or_garbage_cookie(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str], cookies: dict[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            client.cookies.update(cookies)
            return await client.get("/api/v1/auth/session")

    response = _run(scenario)

    assert response.status_code == 200
    assert response.json() is None


def test_session_read_returns_null_for_a_cookie_minted_under_a_different_secret(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    # Mint the session under one app instance/secret, then read it back
    # through a second app instance built after `SESSION_SECRET` rotated —
    # the digest computed at verification time never matches, so the
    # cookie reads as signed out. The two apps share the same database
    # (`DATABASE_URL` from `seeded_user`'s `migrated_db_path`), only the
    # secret differs.
    valid_env.setenv("SESSION_SECRET", "secret-one")
    app_before_rotation = app_factory()

    async def login_and_capture_token() -> str:
        async with make_client(app_before_rotation) as client:
            login_response = await _login(client)
            assert login_response.status_code == 200
            token = client.cookies.get("planora_session")
            assert token is not None
            return token

    token = _run(login_and_capture_token)

    valid_env.setenv("SESSION_SECRET", "secret-two")
    app_after_rotation = app_factory()

    async def read_with_old_cookie() -> Response:
        async with make_client(app_after_rotation) as client:
            client.cookies.set("planora_session", token)
            return await client.get("/api/v1/auth/session")

    response = _run(read_with_old_cookie)
    assert response.status_code == 200
    assert response.json() is None


def test_expired_session_reads_as_signed_out_even_with_cookie_still_sent(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    login_time = datetime(2026, 1, 1, tzinfo=UTC)
    app.dependency_overrides[get_current_time] = lambda: login_time

    async def login_and_capture() -> str:
        async with make_client(app) as client:
            await _login(client)
            token = client.cookies.get("planora_session")
            assert token is not None
            return token

    token = _run(login_and_capture)

    # 14 days + 1 second later — just past the fixed lifetime.
    past_expiry = login_time + timedelta(days=14, seconds=1)
    app.dependency_overrides[get_current_time] = lambda: past_expiry

    async def read_after_expiry() -> Response:
        async with make_client(app) as client:
            client.cookies.set("planora_session", token)
            return await client.get("/api/v1/auth/session")

    response = _run(read_after_expiry)
    assert response.status_code == 200
    assert response.json() is None


def test_logout_with_valid_cookie_clears_session_and_cookie(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            logout_response = await client.post("/api/v1/auth/logout")
            session_after = await client.get("/api/v1/auth/session")
            return logout_response, session_after

    logout_response, session_after = _run(scenario)

    assert logout_response.status_code == 204
    set_cookie = logout_response.headers["set-cookie"]
    assert set_cookie.startswith("planora_session=")
    assert "Max-Age=0" in set_cookie
    assert "Path=/" in set_cookie

    assert session_after.json() is None


def test_logout_is_idempotent_with_no_cookie_and_with_an_already_logged_out_cookie(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response, Response]:
        async with make_client(app) as client:
            no_cookie_response = await client.post("/api/v1/auth/logout")

            await _login(client)
            first_logout = await client.post("/api/v1/auth/logout")
            second_logout = await client.post("/api/v1/auth/logout")
            return no_cookie_response, first_logout, second_logout

    no_cookie_response, first_logout, second_logout = _run(scenario)

    assert no_cookie_response.status_code == 204
    assert first_logout.status_code == 204
    assert second_logout.status_code == 204


# --- require_session, on a route mounted only in this test app -------------

_test_router = APIRouter()


@_test_router.get("/api/v1/__test_only/protected")
def _protected(session: Annotated[AuthSession, Depends(require_session)]) -> dict[str, str]:
    return {"token_digest": session.token_digest}


def test_require_session_rejects_missing_invalid_and_expired_cookies_and_passes_valid_ones(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    app.include_router(_test_router)

    async def scenario() -> tuple[Response, Response, Response]:
        async with make_client(app) as client:
            missing = await client.get("/api/v1/__test_only/protected")

            client.cookies.set("planora_session", "garbage")
            invalid = await client.get("/api/v1/__test_only/protected")
            client.cookies.delete("planora_session")

            await _login(client)
            valid = await client.get("/api/v1/__test_only/protected")
            return missing, invalid, valid

    missing, invalid, valid = _run(scenario)

    assert missing.status_code == 401
    assert missing.json() == {"code": "NOT_AUTHENTICATED", "message": "Sign in required."}

    assert invalid.status_code == 401
    assert invalid.json()["code"] == "NOT_AUTHENTICATED"

    assert valid.status_code == 200
    assert "token_digest" in valid.json()


def test_require_session_rejects_an_expired_cookie(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    app.include_router(_test_router)
    login_time = datetime(2026, 1, 1, tzinfo=UTC)
    app.dependency_overrides[get_current_time] = lambda: login_time

    async def login_and_capture() -> str:
        async with make_client(app) as client:
            await _login(client)
            token = client.cookies.get("planora_session")
            assert token is not None
            return token

    token = _run(login_and_capture)

    app.dependency_overrides[get_current_time] = lambda: login_time + timedelta(days=15)

    async def call_protected() -> Response:
        async with make_client(app) as client:
            client.cookies.set("planora_session", token)
            return await client.get("/api/v1/__test_only/protected")

    response = _run(call_protected)
    assert response.status_code == 401
    assert response.json()["code"] == "NOT_AUTHENTICATED"
