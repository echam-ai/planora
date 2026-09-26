"""Integration tests for `POST /api/v1/auth/login` (issue #25).

Uses the HTTPX `AsyncClient` against the real ASGI app, exactly like
`tests/integration/test_health.py` — no browser needed. `migrated_db_path`
(via `seeded_user`) applies the Alembic migration to a disposable SQLite
file under the repo's `.tmp/`, and `app_factory()` (see `conftest.py`)
builds a fresh app per test against that same database through
`DATABASE_URL`, disposing its engine at teardown. `make_client` (also
`conftest.py`) sends the configured `APP_ORIGIN` as `Origin` by default —
required since issue #26's CSRF middleware rejects any unsafe request
without it.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from conftest import AUTH_PASSWORD, AUTH_USERNAME, make_client
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy.orm import Session, sessionmaker

from planora_api.security import password as password_security


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _post_login(client: AsyncClient, username: str, password: str) -> Response:
    return await client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )


def test_correct_credentials_return_200_with_cookie_and_body(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    valid_env.setenv("APP_ORIGIN", "https://planora.example")
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await _post_login(client, AUTH_USERNAME, AUTH_PASSWORD)

    response = _run(scenario)

    assert response.status_code == 200
    assert set(response.json().keys()) == {"username", "signed_in_at"}
    assert response.json()["username"] == AUTH_USERNAME

    set_cookie = response.headers["set-cookie"]
    assert set_cookie.startswith("planora_session=")
    assert "HttpOnly" in set_cookie
    assert "SameSite=Lax" in set_cookie
    assert "Path=/" in set_cookie
    assert "Max-Age=1209600" in set_cookie


@pytest.mark.parametrize(
    ("app_origin", "expect_secure"),
    [
        ("https://planora.example", True),
        ("http://203.0.113.5", True),
        ("http://localhost:3000", False),
        ("http://127.0.0.1:3000", False),
    ],
)
def test_cookie_secure_flag_follows_app_origin(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_origin: str,
    expect_secure: bool,
    app_factory: Callable[[], FastAPI],
) -> None:
    valid_env.setenv("APP_ORIGIN", app_origin)
    app = app_factory()

    async def scenario() -> Response:
        # `APP_ORIGIN` was just overridden above — send that same origin,
        # not `make_client`'s `https://planora.example` default, or issue
        # #26's CSRF middleware would reject this as a foreign origin.
        async with make_client(app, origin=app_origin) as client:
            return await _post_login(client, AUTH_USERNAME, AUTH_PASSWORD)

    response = _run(scenario)

    set_cookie = response.headers["set-cookie"]
    assert ("Secure" in set_cookie) is expect_secure


def test_wrong_password_returns_401_invalid_credentials_and_sets_no_cookie(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await _post_login(client, AUTH_USERNAME, "definitely-wrong")

    response = _run(scenario)

    assert response.status_code == 401
    assert response.json() == {"code": "INVALID_CREDENTIALS", "message": "Incorrect username or password."}
    assert "set-cookie" not in response.headers


def test_unknown_username_returns_a_byte_identical_401_response(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            wrong_password = await _post_login(client, AUTH_USERNAME, "definitely-wrong")
            unknown_user = await _post_login(client, "nobody", "whatever")
            return wrong_password, unknown_user

    wrong_password_response, unknown_user_response = _run(scenario)

    assert unknown_user_response.status_code == wrong_password_response.status_code == 401
    assert unknown_user_response.content == wrong_password_response.content
    assert "set-cookie" not in unknown_user_response.headers


def test_login_with_no_app_user_returns_invalid_credentials(
    migrated_db_path: object,
    app_factory: Callable[[], FastAPI],
) -> None:
    # `migrated_db_path` applies the migration but seeds no user — until
    # #33 lands, this is the real behavior of a fresh install: every login
    # returns INVALID_CREDENTIALS.
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await _post_login(client, "anyone", "anything")

    response = _run(scenario)

    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_CREDENTIALS"


def test_each_login_outcome_calls_argon2_verify_exactly_once(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    call_count = {"n": 0}
    real_verify = password_security.verify_password

    def counting_verify(password_hash: str, password: str) -> bool:
        call_count["n"] += 1
        return real_verify(password_hash, password)

    async def scenario() -> None:
        async with make_client(app) as client:
            password_security.verify_password = counting_verify
            try:
                call_count["n"] = 0
                await _post_login(client, AUTH_USERNAME, "wrong")
                assert call_count["n"] == 1

                call_count["n"] = 0
                await _post_login(client, "unknown-user", "whatever")
                assert call_count["n"] == 1

                call_count["n"] = 0
                await _post_login(client, AUTH_USERNAME, AUTH_PASSWORD)
                assert call_count["n"] == 1
            finally:
                password_security.verify_password = real_verify

    _run(scenario)


def test_session_fixation_login_rotates_the_token(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[str, str, Response]:
        async with make_client(app) as client:
            await _post_login(client, AUTH_USERNAME, AUTH_PASSWORD)
            first_cookie = client.cookies.get("planora_session")
            assert first_cookie is not None

            await _post_login(client, AUTH_USERNAME, AUTH_PASSWORD)
            second_cookie = client.cookies.get("planora_session")
            assert second_cookie is not None
            assert second_cookie != first_cookie

            # Present the first (now-revoked) cookie explicitly and read
            # the session with it.
            client.cookies.set("planora_session", first_cookie)
            old_cookie_response = await client.get("/api/v1/auth/session")
            return first_cookie, second_cookie, old_cookie_response

    first_cookie, second_cookie, old_cookie_response = _run(scenario)

    assert first_cookie != second_cookie
    assert old_cookie_response.json() is None


def test_a_successful_login_upgrades_a_hash_that_needs_rehashing(
    valid_env: pytest.MonkeyPatch, migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    # Seed a hash produced under weaker-than-current Argon2 parameters so
    # `needs_rehash` is true, then confirm login upgrades it in place.
    from datetime import UTC, datetime

    from argon2 import PasswordHasher

    from planora_api.db import auth_repository

    weak_hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    weak_hash = weak_hasher.hash(AUTH_PASSWORD)

    with migrated_session_factory() as session:
        auth_repository.upsert_app_user(
            session, username=AUTH_USERNAME, password_hash=weak_hash, now=datetime.now(UTC)
        )
        session.commit()

    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await _post_login(client, AUTH_USERNAME, AUTH_PASSWORD)

    response = _run(scenario)
    assert response.status_code == 200

    with migrated_session_factory() as session:
        user = auth_repository.get_app_user(session)
        assert user is not None
        assert user.password_hash != weak_hash
        assert user.password_hash.startswith("$argon2id$")
        assert password_security.verify_password(user.password_hash, AUTH_PASSWORD)
