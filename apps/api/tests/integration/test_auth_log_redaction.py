"""No log record carries the password, the secret or the cookie (AC2)."""

from __future__ import annotations

import asyncio
import io
import logging

import pytest
from conftest import APP_PASSWORD, SESSION_SECRET, make_client

from planora_api.config import load_settings
from planora_api.logging import JsonFormatter, redact

WRONG = "wrong-SENTINEL-password"
LOGIN = "/api/v1/auth/login"


def test_login_attempts_and_gated_requests_log_no_secret(valid_env, app_factory) -> None:
    app = app_factory()
    root = logging.getLogger()
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter((APP_PASSWORD, SESSION_SECRET)))
    handler.setLevel(logging.DEBUG)
    root.addHandler(handler)
    previous_level = root.level
    root.setLevel(logging.DEBUG)
    cookie_value = ""

    async def scenario() -> None:
        nonlocal cookie_value
        async with make_client(app, authenticated=False) as client:
            await client.post(LOGIN, json={"password": WRONG})
            response = await client.post(LOGIN, json={"password": APP_PASSWORD})
            cookie_value = response.cookies["planora_access"]
            await client.get("/api/v1/profiles")
            await client.post(LOGIN, json={"password": ""})
            await client.post("/api/v1/auth/logout")
        async with make_client(app, authenticated=False) as client:
            await client.get("/api/v1/tasks", headers={"X-Planora-Profile": "hamster_knight"})

    try:
        asyncio.run(scenario())
    finally:
        root.removeHandler(handler)
        root.setLevel(previous_level)

    output = stream.getvalue()
    assert "Request completed" in output
    assert cookie_value
    for secret in (APP_PASSWORD, WRONG, SESSION_SECRET, cookie_value):
        assert secret not in output


def test_a_cookie_header_in_free_text_is_redacted() -> None:
    text = "Cookie: planora_access=abc.def.ghi; other=1"
    assert "abc.def.ghi" not in redact(text)


def test_settings_secrets_are_listed_for_redaction(valid_env: pytest.MonkeyPatch) -> None:
    settings = load_settings()
    assert "***REDACTED***" in repr(settings)
    assert APP_PASSWORD not in repr(settings) and SESSION_SECRET not in repr(settings)
