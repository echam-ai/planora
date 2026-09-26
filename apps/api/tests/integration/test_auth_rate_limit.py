"""Integration tests for login rate limiting (issue #25): 5 failed logins
from one client IP within 15 minutes block the 6th; a success clears the
count; the limit survives a fresh app instance over the same database.

`httpx.ASGITransport(client=(host, port))` becomes `request.client.host`
inside the app — that's how these tests target different "client IPs"
without a real network. The transport's `client` is fixed at construction
(not overridable per request in this httpx version), so `_login_from`
builds one short-lived client per call, each pointed at the same `app` (and
therefore the same database) but a different simulated source IP.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import AUTH_PASSWORD, AUTH_USERNAME
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response

from planora_api.api.deps import get_current_time
from planora_api.security import password as password_security

IP_A = "198.51.100.7"
IP_B = "198.51.100.8"


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _login_from(app: FastAPI, host: str, password: str) -> Response:
    transport = ASGITransport(app=app, client=(host, 12345))
    async with AsyncClient(transport=transport, base_url="https://test") as client:
        return await client.post(
            "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": password}
        )


def test_sixth_failed_attempt_from_one_ip_is_rate_limited(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[list[Response], Response]:
        failures = [await _login_from(app, IP_A, "wrong") for _ in range(5)]
        sixth = await _login_from(app, IP_A, AUTH_PASSWORD)  # correct password
        return failures, sixth

    failures, sixth = _run(scenario)

    assert all(response.status_code == 401 for response in failures)
    assert sixth.status_code == 429
    assert sixth.json()["code"] == "RATE_LIMITED"
    assert "set-cookie" not in sixth.headers
    retry_after = int(sixth.headers["retry-after"])
    assert retry_after >= 1


def test_a_different_ip_is_not_limited_by_the_first(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        for _ in range(5):
            await _login_from(app, IP_A, "wrong")
        blocked = await _login_from(app, IP_A, AUTH_PASSWORD)
        still_ok = await _login_from(app, IP_B, AUTH_PASSWORD)
        return blocked, still_ok

    blocked, still_ok = _run(scenario)

    assert blocked.status_code == 429
    assert still_ok.status_code == 200


def test_limit_lifts_once_the_oldest_failure_leaves_the_window(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    start = datetime(2026, 1, 1, tzinfo=UTC)
    app.dependency_overrides[get_current_time] = lambda: start

    async def fail_five_times() -> Response:
        for _ in range(5):
            await _login_from(app, IP_A, "wrong")
        return await _login_from(app, IP_A, AUTH_PASSWORD)

    blocked = _run(fail_five_times)
    assert blocked.status_code == 429

    # 15 minutes and one second later, the oldest (and only) failure batch
    # has left the window.
    app.dependency_overrides[get_current_time] = lambda: start + timedelta(minutes=15, seconds=1)

    async def try_again() -> Response:
        return await _login_from(app, IP_A, AUTH_PASSWORD)

    unblocked = _run(try_again)
    assert unblocked.status_code == 200


def test_a_successful_login_clears_the_failure_count_for_that_ip(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> list[Response]:
        responses = []
        for _ in range(4):
            responses.append(await _login_from(app, IP_A, "wrong"))
        responses.append(await _login_from(app, IP_A, AUTH_PASSWORD))  # success, clears count
        for _ in range(4):
            responses.append(await _login_from(app, IP_A, "wrong"))
        return responses

    responses = _run(scenario)

    # None of the nine attempts was rate-limited: 4 failures, a success,
    # then 4 more failures — never reaching 5 in a row.
    assert all(response.status_code != 429 for response in responses)
    assert [r.status_code for r in responses] == [401, 401, 401, 401, 200, 401, 401, 401, 401]


def test_the_limit_survives_a_fresh_app_instance_over_the_same_database(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def fail_five_times() -> None:
        for _ in range(5):
            await _login_from(app, IP_A, "wrong")

    _run(fail_five_times)

    # A brand-new FastAPI app/session-factory, bound to the same
    # DATABASE_URL — nothing in-process is shared with `app` above.
    fresh_app = app_factory()

    async def try_from_fresh_app() -> Response:
        return await _login_from(fresh_app, IP_A, AUTH_PASSWORD)

    response = _run(try_from_fresh_app)
    assert response.status_code == 429


def test_a_rate_limited_attempt_never_calls_argon2_verify(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    call_count = {"n": 0}
    real_verify = password_security.verify_password

    def counting_verify(password_hash: str, password: str) -> bool:
        call_count["n"] += 1
        return real_verify(password_hash, password)

    async def scenario() -> Response:
        for _ in range(5):
            await _login_from(app, IP_A, "wrong")
        password_security.verify_password = counting_verify
        try:
            call_count["n"] = 0
            return await _login_from(app, IP_A, AUTH_PASSWORD)  # correct password, but blocked
        finally:
            password_security.verify_password = real_verify

    response = _run(scenario)

    assert response.status_code == 429
    assert call_count["n"] == 0
