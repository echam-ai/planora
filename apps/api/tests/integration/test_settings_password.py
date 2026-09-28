"""Integration tests for `POST /api/v1/settings/password` (issue #31, spec
§3.2). Session revocation on a successful change follows the #25 grooming
note (issue #31, comment): the user's *other* sessions end, the session
that made the change stays valid.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from conftest import AUTH_PASSWORD, AUTH_USERNAME, make_client
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.db.models import AppUser, AuthSession
from planora_api.security import password as password_security

PASSWORD_URL = "/api/v1/settings/password"
SETTINGS_URL = "/api/v1/settings"
FOREIGN_ORIGIN = "https://evil.example"
NEW_PASSWORD = "a-brand-new-password"


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _login(client: AsyncClient, password: str = AUTH_PASSWORD) -> Response:
    return await client.post(
        "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": password}
    )


def _get_user(session_factory: sessionmaker[Session]) -> AppUser:
    with session_factory() as session:
        user = session.get(AppUser, 1)
        assert user is not None
        return user


def _session_count(session_factory: sessionmaker[Session]) -> int:
    with session_factory() as session:
        return len(list(session.execute(select(AuthSession)).scalars().all()))


# --- Success ------------------------------------------------------------


def test_correct_current_password_succeeds_and_new_password_logs_in(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            change = await client.post(
                PASSWORD_URL,
                json={"current_password": AUTH_PASSWORD, "new_password": NEW_PASSWORD},
            )
            old_login = await _login(client, AUTH_PASSWORD)
            new_login = await _login(client, NEW_PASSWORD)
            return change, old_login, new_login

    change, old_login, new_login = _run(scenario)

    assert change.status_code == 204
    assert change.text == ""
    assert old_login.status_code == 401
    assert old_login.json()["code"] == "INVALID_CREDENTIALS"
    assert new_login.status_code == 200


def test_stored_hash_after_success_is_argon2id_and_updated_at_is_request_time(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    from datetime import UTC, datetime

    from planora_api.api.deps import get_current_time

    app = app_factory()
    request_time = datetime(2026, 5, 1, 12, 0, 0, tzinfo=UTC)
    app.dependency_overrides[get_current_time] = lambda: request_time

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(
                PASSWORD_URL,
                json={"current_password": AUTH_PASSWORD, "new_password": NEW_PASSWORD},
            )

    response = _run(scenario)
    assert response.status_code == 204

    user = _get_user(migrated_session_factory)
    assert user.password_hash.startswith("$argon2id$")
    assert user.password_hash != AUTH_PASSWORD
    assert user.password_hash != NEW_PASSWORD
    assert user.updated_at == request_time
    assert password_security.verify_password(user.password_hash, NEW_PASSWORD)


def test_success_revokes_every_other_session_but_keeps_the_current_one(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response, Response, Response]:
        async with make_client(app) as client_a, make_client(app) as client_b:
            await _login(client_a)
            await _login(client_b)

            change = await client_a.post(
                PASSWORD_URL,
                json={"current_password": AUTH_PASSWORD, "new_password": NEW_PASSWORD},
            )
            a_after = await client_a.get(SETTINGS_URL)
            b_after = await client_b.get(SETTINGS_URL)
            return change, a_after, b_after, change

    change, a_after, b_after, _ = _run(scenario)

    assert change.status_code == 204
    # No new cookie set on the response that performed the change.
    assert "set-cookie" not in change.headers

    assert a_after.status_code == 200
    assert b_after.status_code == 401
    assert b_after.json()["code"] == "NOT_AUTHENTICATED"

    assert _session_count(migrated_session_factory) == 1


# --- Wrong current password -----------------------------------------------


def test_wrong_current_password_returns_400_and_hash_and_sessions_unchanged(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    hash_before = _get_user(migrated_session_factory).password_hash
    updated_at_before = _get_user(migrated_session_factory).updated_at

    async def scenario() -> tuple[Response, Response, Response]:
        async with make_client(app) as client_a, make_client(app) as client_b:
            await _login(client_a)
            await _login(client_b)

            change = await client_a.post(
                PASSWORD_URL,
                json={"current_password": "totally-wrong", "new_password": NEW_PASSWORD},
            )
            a_after = await client_a.get(SETTINGS_URL)
            b_after = await client_b.get(SETTINGS_URL)
            return change, a_after, b_after

    change, a_after, b_after = _run(scenario)

    assert change.status_code == 400
    assert change.json()["code"] == "WRONG_PASSWORD"

    user_after = _get_user(migrated_session_factory)
    assert user_after.password_hash == hash_before
    assert user_after.updated_at == updated_at_before

    assert a_after.status_code == 200
    assert b_after.status_code == 200
    assert _session_count(migrated_session_factory) == 2


def test_verify_password_is_called_exactly_once_against_the_stored_hash(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = app_factory()
    call_count = {"n": 0}
    real_verify = password_security.verify_password

    def counting_verify(password_hash: str, password: str) -> bool:
        call_count["n"] += 1
        return real_verify(password_hash, password)

    monkeypatch.setattr(password_security, "verify_password", counting_verify)

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _login(client)
            wrong = await client.post(
                PASSWORD_URL,
                json={"current_password": "wrong", "new_password": NEW_PASSWORD},
            )
            call_count["n"] = 0
            correct = await client.post(
                PASSWORD_URL,
                json={"current_password": AUTH_PASSWORD, "new_password": NEW_PASSWORD},
            )
            return wrong, correct

    call_count["n"] = 0
    wrong, correct = _run(scenario)

    assert wrong.status_code == 400
    assert correct.status_code == 204
    assert call_count["n"] == 1


# --- Validation -------------------------------------------------------------


@pytest.mark.parametrize("new_password", ["short", "12345", "x" * 1025])
def test_new_password_outside_length_bounds_returns_422_and_hash_unchanged(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    new_password: str,
) -> None:
    app = app_factory()
    hash_before = _get_user(migrated_session_factory).password_hash

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(
                PASSWORD_URL,
                json={"current_password": AUTH_PASSWORD, "new_password": new_password},
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"
    fields = {detail["field"] for detail in response.json()["details"]}
    assert "new_password" in fields
    assert _get_user(migrated_session_factory).password_hash == hash_before


def test_new_password_length_is_checked_before_verifying_current_password(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = app_factory()
    call_count = {"n": 0}

    def counting_verify(password_hash: str, password: str) -> bool:
        call_count["n"] += 1
        return False

    async def scenario() -> Response:
        async with make_client(app) as client:
            # Log in with the real verifier first — only the
            # settings/password call below should be spied on.
            await _login(client)
            monkeypatch.setattr(password_security, "verify_password", counting_verify)
            return await client.post(
                PASSWORD_URL,
                json={"current_password": AUTH_PASSWORD, "new_password": "short"},
            )

    response = _run(scenario)

    assert response.status_code == 422
    assert call_count["n"] == 0


@pytest.mark.parametrize(
    "body",
    [
        {"new_password": "a-brand-new-password"},
        {"current_password": AUTH_PASSWORD},
        {},
    ],
)
def test_missing_fields_return_422(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
    body: dict[str, str],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _login(client)
            return await client.post(PASSWORD_URL, json=body)

    response = _run(scenario)
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


# --- Security and contract ---------------------------------------------------


def test_change_password_requires_authentication(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.post(
                PASSWORD_URL,
                json={"current_password": AUTH_PASSWORD, "new_password": NEW_PASSWORD},
            )

    response = _run(scenario)
    assert response.status_code == 401
    assert response.json()["code"] == "NOT_AUTHENTICATED"


def test_change_password_rejects_a_mismatched_origin_and_changes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    hash_before = _get_user(migrated_session_factory).password_hash

    async def login_and_get_cookie() -> dict[str, str]:
        async with make_client(app) as client:
            await _login(client)
            return dict(client.cookies)

    cookies = _run(login_and_get_cookie)

    async def cross_origin_change() -> Response:
        async with make_client(app, origin=FOREIGN_ORIGIN) as client:
            client.cookies.update(cookies)
            return await client.post(
                PASSWORD_URL,
                json={"current_password": AUTH_PASSWORD, "new_password": NEW_PASSWORD},
            )

    response = _run(cross_origin_change)
    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"
    assert _get_user(migrated_session_factory).password_hash == hash_before
    assert _session_count(migrated_session_factory) == 1


def test_no_response_ever_contains_password_hash_or_argon2_marker(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> list[Response]:
        async with make_client(app) as client:
            await _login(client)
            wrong = await client.post(
                PASSWORD_URL,
                json={"current_password": "wrong", "new_password": NEW_PASSWORD},
            )
            correct = await client.post(
                PASSWORD_URL,
                json={"current_password": AUTH_PASSWORD, "new_password": NEW_PASSWORD},
            )
            return [wrong, correct]

    responses = _run(scenario)
    for response in responses:
        assert "password_hash" not in response.text
        assert "$argon2" not in response.text


def test_no_captured_log_at_debug_contains_either_password(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    valid_env.setenv("LOG_LEVEL", "DEBUG")
    app = app_factory()
    caplog.set_level(logging.DEBUG)
    wrong_current = "SENTINEL-wrong-current-password"
    new_password_sentinel = "SENTINEL-new-password-value"

    async def scenario() -> None:
        async with make_client(app) as client:
            await _login(client)
            # Failed change: wrong current password.
            await client.post(
                PASSWORD_URL,
                json={"current_password": wrong_current, "new_password": new_password_sentinel},
            )
            # Successful change: correct current password, new sentinel.
            await client.post(
                PASSWORD_URL,
                json={
                    "current_password": AUTH_PASSWORD,
                    "new_password": new_password_sentinel,
                },
            )

    _run(scenario)

    for record in caplog.records:
        message = record.getMessage()
        assert wrong_current not in message
        assert new_password_sentinel not in message
        assert AUTH_PASSWORD not in message

    captured = capsys.readouterr()
    for stream in (captured.out, captured.err):
        assert wrong_current not in stream
        assert new_password_sentinel not in stream
        assert AUTH_PASSWORD not in stream


def test_change_password_returns_401_when_the_account_no_longer_exists(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    # A valid, unexpired session row with no matching app_user row isn't
    # reachable through the real login flow, but the route must not trust
    # a session row to imply a user row exists — matches
    # test_auth_session_logout.py's identical defensive-check test for
    # `GET /api/v1/auth/session`.
    from datetime import UTC, datetime

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
            return await client.post(
                PASSWORD_URL,
                json={"current_password": "whatever", "new_password": NEW_PASSWORD},
            )

    response = _run(scenario)
    assert response.status_code == 401
    assert response.json()["code"] == "NOT_AUTHENTICATED"
