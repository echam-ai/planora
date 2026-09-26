"""Integration tests that no secret ever leaks from `/api/v1/auth/*`
(issue #25): not `password_hash`, not an `$argon2` hash, not a submitted
password — including in a 422 validation body — and not in a captured log
line, at DEBUG, from any of the three endpoints.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from conftest import AUTH_USERNAME, make_client
from fastapi import FastAPI
from httpx import AsyncClient, Response

SENTINEL = "SENTINEL-7f3a-do-not-log"


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


def _assert_no_secret_leak(response: Response) -> None:
    text = response.text
    assert "password_hash" not in text
    assert "$argon2" not in text
    assert SENTINEL not in text


def test_no_response_ever_contains_password_hash_or_argon2_marker(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> list[Response]:
        async with make_client(app) as client:
            responses = [
                await client.post(
                    "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": SENTINEL}
                ),
                await client.get("/api/v1/auth/session"),
                await client.post("/api/v1/auth/logout"),
            ]
            return responses

    responses = _run(scenario)

    for response in responses:
        _assert_no_secret_leak(response)


def test_422_with_missing_username_does_not_echo_the_sentinel_password(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            # `username` missing entirely; FastAPI's default 422 body would
            # otherwise include an `input` key holding this whole dict,
            # sentinel password included.
            return await client.post("/api/v1/auth/login", json={"password": SENTINEL})

    response = _run(scenario)

    assert response.status_code == 422
    _assert_no_secret_leak(response)
    body = response.json()
    assert set(body.keys()) <= {"code", "message", "field"}
    assert "input" not in body


def test_422_with_malformed_body_does_not_echo_the_sentinel_password(
    valid_env: pytest.MonkeyPatch, seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            # `password` present but the wrong type — still must not echo it.
            return await client.post(
                "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": [SENTINEL]}
            )

    response = _run(scenario)

    assert response.status_code == 422
    _assert_no_secret_leak(response)


@pytest.mark.parametrize(
    "make_request",
    [
        lambda client: client.post(
            "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": SENTINEL}
        ),
        lambda client: client.post(
            "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": "wrong-" + SENTINEL}
        ),
    ],
)
def test_login_attempts_leave_no_sentinel_or_token_in_captured_logs(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
    make_request: Callable[[AsyncClient], Awaitable[Response]],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    caplog.set_level(logging.DEBUG)

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await make_request(client)

    _run(scenario)

    for record in caplog.records:
        assert SENTINEL not in record.getMessage()
    captured = capsys.readouterr()
    assert SENTINEL not in captured.out
    assert SENTINEL not in captured.err


def test_rate_limited_login_leaves_no_sentinel_or_token_in_captured_logs(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()
    caplog.set_level(logging.DEBUG)

    async def scenario() -> Response:
        async with make_client(app) as client:
            for _ in range(5):
                await client.post(
                    "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": SENTINEL}
                )
            return await client.post(
                "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": SENTINEL}
            )

    response = _run(scenario)
    assert response.status_code == 429

    for record in caplog.records:
        assert SENTINEL not in record.getMessage()
    captured = capsys.readouterr()
    assert SENTINEL not in captured.out
    assert SENTINEL not in captured.err


def test_a_successful_login_never_logs_the_issued_session_token(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
    app_factory: Callable[[], FastAPI],
) -> None:
    from conftest import AUTH_PASSWORD

    app = app_factory()
    caplog.set_level(logging.DEBUG)

    async def scenario() -> str:
        async with make_client(app) as client:
            await client.post(
                "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD}
            )
            token = client.cookies.get("planora_session")
            assert token is not None
            return token

    token = _run(scenario)

    for record in caplog.records:
        assert token not in record.getMessage()
    captured = capsys.readouterr()
    assert token not in captured.out
    assert token not in captured.err
