"""Shared site password: login, logout, session, cookie and limiter (issue #124).

Covers AC3-AC7, AC11-AC13. Auth endpoints touch no table, so no migrated
database is needed. Time is injected through `create_app(access_clock=...)`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from conftest import APP_PASSWORD, SESSION_SECRET, FakeClock, make_client
from httpx import AsyncClient, Response

from planora_api.security import access

LOGIN = "/api/v1/auth/login"
LOGOUT = "/api/v1/auth/logout"
SESSION = "/api/v1/auth/session"
WRONG = "definitely-not-the-password"


def _run(scenario: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(scenario())


def _cookie_lines(response: Response) -> list[str]:
    return response.headers.get_list("set-cookie")


def _attrs(line: str) -> dict[str, str]:
    parts = [p.strip() for p in line.split(";")]
    out = {"__name__": parts[0].split("=", 1)[0], "__value__": parts[0].split("=", 1)[1]}
    for part in parts[1:]:
        key, _, value = part.partition("=")
        out[key.lower()] = value
    return out


async def _login(client: AsyncClient, password: str = APP_PASSWORD, **kwargs: Any) -> Response:
    return await client.post(LOGIN, json={"password": password}, **kwargs)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def app(valid_env, app_factory, clock):
    return app_factory(access_clock=clock)


def test_login_success_sets_the_cookie_and_session_reports_it(app) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            assert (await client.get(SESSION)).json() == {"authenticated": False}
            response = await _login(client)
            assert response.status_code == 200
            assert response.json() == {"authenticated": True}
            assert response.headers["cache-control"] == "no-store"
            (line,) = _cookie_lines(response)
            attrs = _attrs(line)
            assert attrs["__name__"] == "planora_access"
            assert "httponly" in attrs
            assert attrs["samesite"].lower() == "lax"
            assert attrs["path"] == "/"
            assert attrs["max-age"] == "2592000"
            assert "secure" in attrs  # APP_ORIGIN is https
            assert (await client.get(SESSION)).json() == {"authenticated": True}

    _run(scenario)


def test_cookie_is_not_secure_for_an_http_origin(valid_env, app_factory, clock) -> None:
    valid_env.setenv("APP_ORIGIN", "http://localhost:5173")
    app = app_factory(access_clock=clock)

    async def scenario() -> None:
        async with make_client(
            app, authenticated=False, origin="http://localhost:5173", base_url="http://localhost:5173"
        ) as client:
            response = await _login(client)
            assert response.status_code == 200
            assert "secure" not in _attrs(_cookie_lines(response)[0])
            logout = await client.post(LOGOUT)
            assert "secure" not in _attrs(_cookie_lines(logout)[0])

    _run(scenario)


def test_cookie_value_holds_no_secret(app) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            token = _attrs((_cookie_lines(await _login(client)))[0])["__value__"]
            assert APP_PASSWORD not in token and SESSION_SECRET not in token

    _run(scenario)


def test_wrong_password_is_401_without_cookie_and_uses_compare_digest(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[tuple[bytes, bytes]] = []
    real = access.hmac.compare_digest

    def spy(a: bytes, b: bytes) -> bool:
        seen.append((a, b))
        return real(a, b)

    monkeypatch.setattr(access.hmac, "compare_digest", spy)

    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            response = await _login(client, WRONG)
            assert response.status_code == 401
            assert response.json() == {"code": "INVALID_PASSWORD", "message": "Incorrect password."}
            assert _cookie_lines(response) == []
            assert (WRONG.encode(), APP_PASSWORD.encode()) in seen

    _run(scenario)


@pytest.mark.parametrize("body", [{}, {"password": ""}, {"password": None}, {"nope": "x"}])
def test_missing_or_empty_password_is_422_and_not_counted(app, body: dict[str, Any]) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            for _ in range(8):
                response = await client.post(LOGIN, json=body)
                assert response.status_code == 422
                assert response.json()["code"] == "VALIDATION_ERROR"
                assert _cookie_lines(response) == []
            assert (await _login(client)).status_code == 200

    _run(scenario)


def test_fifth_failure_blocks_the_sixth_even_with_the_right_password(app, clock) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False, client=("203.0.113.5", 1)) as client:
            for _ in range(5):
                assert (await _login(client, WRONG)).status_code == 401
            blocked = await _login(client)
            assert blocked.status_code == 429
            assert blocked.json()["code"] == "RATE_LIMITED"
            assert blocked.headers["retry-after"] == "900"
            assert _cookie_lines(blocked) == []
            clock.advance(seconds=100)
            assert (await _login(client)).headers["retry-after"] == "800"
            # Fifteen minutes after the failures the IP is allowed again.
            clock.advance(seconds=800)
            assert (await _login(client)).status_code == 200

    _run(scenario)


def test_block_does_not_extend_by_blocked_attempts(app, clock) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            for _ in range(5):
                await _login(client, WRONG)
            for _ in range(3):
                assert (await _login(client, WRONG)).status_code == 429
            clock.advance(minutes=15)
            assert (await _login(client)).status_code == 200

    _run(scenario)


def test_other_ip_is_unaffected_and_success_resets_the_count(app) -> None:
    async def scenario() -> None:
        async with (
            make_client(app, authenticated=False, client=("203.0.113.5", 1)) as blocked,
            make_client(app, authenticated=False, client=("198.51.100.9", 1)) as other,
        ):
            for _ in range(5):
                await _login(blocked, WRONG)
            assert (await _login(blocked)).status_code == 429
            # Four failures, a success, then four more: never blocked.
            for _ in range(4):
                assert (await _login(other, WRONG)).status_code == 401
            assert (await _login(other)).status_code == 200
            for _ in range(4):
                assert (await _login(other, WRONG)).status_code == 401
            assert (await _login(other)).status_code == 200

    _run(scenario)


def test_forwarded_for_header_does_not_change_the_limiter_key(app) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False, client=("203.0.113.5", 1)) as client:
            for i in range(5):
                response = await _login(client, WRONG, headers={"X-Forwarded-For": f"10.0.0.{i}"})
                assert response.status_code == 401
            response = await _login(client, WRONG, headers={"X-Forwarded-For": "10.9.9.9"})
            assert response.status_code == 429
            assert app.state.login_limiter.tracked_clients() == 1

    _run(scenario)


def test_stale_failures_are_pruned_from_memory(app, clock) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False, client=("203.0.113.5", 1)) as a:
            await _login(a, WRONG)
        assert app.state.login_limiter.tracked_clients() == 1
        clock.advance(minutes=15)
        async with make_client(app, authenticated=False, client=("198.51.100.9", 1)) as b:
            await _login(b, WRONG)
        assert app.state.login_limiter.tracked_clients() == 1

    _run(scenario)


@pytest.mark.parametrize("origin", [None, "null", "https://evil.example"])
def test_csrf_covers_login_and_logout_and_adds_nothing_to_the_limit(app, origin) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False, origin=origin) as client:
            for _ in range(10):
                for path in (LOGIN, LOGOUT):
                    response = await client.post(path, json={"password": WRONG})
                    assert response.status_code == 403
                    assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"
                    assert _cookie_lines(response) == []
        async with make_client(app, authenticated=False) as client:
            assert (await _login(client)).status_code == 200

    _run(scenario)


def test_logout_expires_the_cookie_with_matching_attributes(app) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            # Without any cookie it still succeeds.
            bare = await client.post(LOGOUT)
            assert bare.status_code == 204 and bare.content == b""
            await _login(client)
            response = await client.post(LOGOUT)
            assert response.status_code == 204
            for r in (bare, response):
                attrs = _attrs(_cookie_lines(r)[0])
                assert attrs["__name__"] == "planora_access"
                assert attrs["max-age"] == "0"
                assert attrs["path"] == "/" and "httponly" in attrs and "secure" in attrs
                assert attrs["samesite"].lower() == "lax"
            assert (await client.get(SESSION)).json() == {"authenticated": False}

    _run(scenario)


def test_session_is_never_401_and_follows_validity(app, clock) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            for cookie in (None, "garbage", "v1.1.2"):
                client.cookies.clear()
                if cookie:
                    client.cookies.set("planora_access", cookie)
                response = await client.get(SESSION)
                assert response.status_code == 200
                assert response.json() == {"authenticated": False}
            client.cookies.clear()
            await _login(client)
            clock.advance(days=30, seconds=-1)
            assert (await client.get(SESSION)).json() == {"authenticated": True}
            clock.advance(seconds=1)
            response = await client.get(SESSION)
            assert (response.status_code, response.json()) == (200, {"authenticated": False})

    _run(scenario)


def test_health_is_public(app) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            response = await client.get("/api/v1/health")
            assert (response.status_code, response.json()) == (200, {"status": "ok"})

    _run(scenario)


def test_rotating_the_secret_or_password_signs_everyone_out(
    valid_env, app_factory, clock
) -> None:
    first = app_factory(access_clock=clock)

    async def issue() -> str:
        async with make_client(first, authenticated=False) as client:
            return _attrs(_cookie_lines(await _login(client))[0])["__value__"]

    token = _run(issue)

    async def check(app: Any) -> bool:
        async with make_client(app, authenticated=False) as client:
            client.cookies.set("planora_access", token)
            return (await client.get(SESSION)).json()["authenticated"]

    assert _run(lambda: check(first)) is True
    valid_env.setenv("SESSION_SECRET", "z" * 40)
    assert _run(lambda: check(app_factory(access_clock=clock))) is False
    valid_env.setenv("SESSION_SECRET", SESSION_SECRET)
    valid_env.setenv("APP_PASSWORD", "a-different-password")
    assert _run(lambda: check(app_factory(access_clock=clock))) is False


def test_site_password_adds_no_table_or_migration(alembic_config) -> None:
    """The cookie is stateless (AC7): the migration head is still #120's."""
    from alembic.script import ScriptDirectory

    from planora_api.db.models import Base

    assert ScriptDirectory.from_config(alembic_config).get_heads() == ["209e984e239b"]
    # Only the tables that already existed before #124 (including #120's
    # retired-credential residue); nothing new backs the cookie or limiter.
    assert set(Base.metadata.tables) == {
        "task", "app_user", "app_settings", "auth_session", "conversation",
        "chat_message", "chat_action", "login_failure",
    }
