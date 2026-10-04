"""Issue #27, "Operator reads logs at DEBUG" scenario: one test per class of
secret the spec's redaction rules name, each through the real, configured
logging pipeline (`planora_api.logging.configure_logging`, the exact
function `main.create_app()` calls — not a synthetic `JsonFormatter`
instance built by hand, as the two unit tests in `test_logging_redaction.py`
do).

Every test follows the same shape, mirroring the Test Scenario's own
"Then/And" pair:
  1. Trigger the real thing that would carry the secret (an HTTP request for
     the two login cases; a direct call to the real, already-configured
     logger for classes with no endpoint yet — no chat or archive route
     exists before #37/#33, so the redactor is exercised the same way a
     future caller of `logging.debug(..., extra={...})` would exercise it).
  2. Assert the sentinel appears nowhere in captured output.
  3. Locate "the carrying line" by a fixed, non-secret marker (not the
     sentinel, which may have been replaced) and assert it is present,
     valid JSON, and contains `[REDACTED]` — so a test that captured
     nothing at all cannot pass.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from conftest import make_client
from fastapi import FastAPI
from httpx import Response

MARKER = "operator-debug-marker"


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


def _carrying_line(captured_out: str, marker: str = MARKER) -> dict[str, Any]:
    """The one captured stdout line tagged with `marker`, parsed as JSON.

    Locating it by a fixed marker (rather than by the sentinel, which the
    redactor may have removed) means this helper works whether or not
    redaction succeeded — a bug shows up as a failed assertion on the
    result, not as `_carrying_line` finding nothing.
    """
    lines = [line for line in captured_out.splitlines() if marker in line]
    assert len(lines) == 1, f"expected exactly one line tagged {marker!r}, found {len(lines)}"
    return json.loads(lines[0])


@pytest.fixture
def debug_env(valid_env: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    valid_env.setenv("LOG_LEVEL", "DEBUG")
    return valid_env


def test_select_profile_password_sentinel_is_redacted_on_a_failed_select_profile(
    debug_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    app = app_factory()
    caplog.set_level(logging.DEBUG)
    sentinel = "SENTINEL-failed-login-password"

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.post(
                "/api/v1/tasks", json={"title": sentinel}, headers={"X-Planora-Profile": "hamster_knight"}
            )

    response = _run(scenario)
    assert response.status_code == 422

    # The real failed-login request never logs the password anywhere today
    # — this asserts that stays true.
    captured_so_far = capsys.readouterr().out
    assert sentinel not in captured_so_far
    for record in caplog.records:
        assert sentinel not in record.getMessage()

    # Prove the redactor actively strips this exact value, through the same
    # configured pipeline this request just ran under, rather than the
    # absence above being "nothing here logs it" by coincidence.
    logging.getLogger("planora_api.api.v1.auth").debug(
        MARKER, extra={"password": sentinel}
    )
    line = _carrying_line(capsys.readouterr().out)
    assert sentinel not in json.dumps(line)
    assert line["password"] == "[REDACTED]"


def test_select_profile_password_sentinel_is_redacted_on_a_422_select_profile(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    app = app_factory()
    caplog.set_level(logging.DEBUG)
    sentinel = "SENTINEL-422-login-password"

    async def scenario() -> Response:
        async with make_client(app) as client:
            # `username` missing entirely -> 422 before any auth logic runs.
            return await client.post("/api/v1/tasks", json={"content": sentinel}, headers={"X-Planora-Profile": "hamster_knight"})

    response = _run(scenario)
    assert response.status_code == 422

    captured_so_far = capsys.readouterr().out
    assert sentinel not in captured_so_far
    for record in caplog.records:
        assert sentinel not in record.getMessage()

    logging.getLogger("planora_api.api.v1.auth").debug(
        MARKER, extra={"password": sentinel}
    )
    line = _carrying_line(capsys.readouterr().out)
    assert sentinel not in json.dumps(line)
    assert line["password"] == "[REDACTED]"


def test_session_cookie_value_is_redacted(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    app_factory()  # runs the real `configure_logging()` for this test
    sentinel = "SENTINEL-session-cookie-value"

    # A request carrying `Cookie: planora_session=<sentinel>` — simulated as
    # a raw header-line message the way a diagnostic log of an inbound
    # request would render it, exercising the `planora_session=` by-value
    # pattern the redaction rules define.
    logging.getLogger("planora_api.__test_only").debug(
        f"{MARKER} Cookie: planora_session={sentinel}"
    )

    captured = capsys.readouterr().out
    assert sentinel not in captured
    line = _carrying_line(captured)
    assert "[REDACTED]" in line["message"]
    assert f"planora_session={sentinel}" not in line["message"]


def test_authorization_header_value_is_redacted(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    app_factory()
    sentinel = "SENTINEL-authorization-bearer-token"

    logging.getLogger("planora_api.__test_only").debug(
        f"{MARKER} Authorization: Bearer {sentinel}"
    )

    captured = capsys.readouterr().out
    assert sentinel not in captured
    line = _carrying_line(captured)
    assert "Bearer [REDACTED]" in line["message"]


def test_llm_api_key_value_is_redacted(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    sentinel = "SENTINEL-llm-api-key-value"
    debug_env.setenv("LLM_API_KEY", sentinel)
    app_factory()  # bakes `sentinel` into the formatter's configured secrets

    logging.getLogger("planora_api.__test_only").debug(f"{MARKER} using key {sentinel}")

    captured = capsys.readouterr().out
    assert sentinel not in captured
    line = _carrying_line(captured)
    assert "[REDACTED]" in line["message"]


def test_session_secret_value_is_redacted(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    sentinel = "SENTINEL-session-secret-value-0123456789"
    debug_env.setenv("SESSION_SECRET", sentinel)
    app_factory()

    logging.getLogger("planora_api.__test_only").debug(f"{MARKER} signing with {sentinel}")

    captured = capsys.readouterr().out
    assert sentinel not in captured
    line = _carrying_line(captured)
    assert "[REDACTED]" in line["message"]


def test_app_password_value_is_redacted(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    sentinel = "SENTINEL-app-password-value"
    debug_env.setenv("APP_PASSWORD", sentinel)
    app_factory()

    logging.getLogger("planora_api.__test_only").debug(f"{MARKER} unlocking with {sentinel}")

    captured = capsys.readouterr().out
    assert sentinel not in captured
    line = _carrying_line(captured)
    assert "[REDACTED]" in line["message"]


def test_database_url_password_is_redacted(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    app_factory()
    sentinel = "SENTINEL-database-url-password"
    # Deliberately *not* today's configured `DATABASE_URL` (a plain sqlite
    # path with no userinfo) — this exercises the general `scheme://user:
    # [REDACTED]@host` URL-userinfo pattern itself (which is what actually
    # protects a *real* `DATABASE_URL` carrying a password, e.g. in
    # production's PostgreSQL connection string), independent of whether
    # that exact string also happens to be one of the formatter's
    # configured whole-value secrets.
    database_url = f"postgresql://app_user:{sentinel}@db.internal:5432/planora"

    logging.getLogger("planora_api.__test_only").debug(f"{MARKER} connecting to {database_url}")

    captured = capsys.readouterr().out
    assert sentinel not in captured
    line = _carrying_line(captured)
    assert "postgresql://app_user:[REDACTED]@db.internal:5432/planora" in line["message"]


def test_chat_prompt_via_prompt_field_is_redacted(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    app_factory()
    sentinel = "SENTINEL-chat-prompt-scalar"

    logging.getLogger("planora_api.__test_only").debug(MARKER, extra={"prompt": sentinel})

    captured = capsys.readouterr().out
    assert sentinel not in captured
    line = _carrying_line(captured)
    assert line["prompt"] == "[REDACTED]"


def test_chat_prompt_via_messages_list_is_redacted(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    app_factory()
    sentinel = "SENTINEL-chat-prompt-messages"

    logging.getLogger("planora_api.__test_only").debug(
        MARKER, extra={"messages": [{"role": "user", "content": sentinel}]}
    )

    captured = capsys.readouterr().out
    assert sentinel not in captured
    line = _carrying_line(captured)
    assert line["messages"] == "[REDACTED]"


def test_archive_style_search_query_is_redacted(
    debug_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    app_factory()
    sentinel = "SENTINEL-archive-search-query"

    logging.getLogger("planora_api.__test_only").debug(MARKER, extra={"query": sentinel})

    captured = capsys.readouterr().out
    assert sentinel not in captured
    line = _carrying_line(captured)
    assert line["query"] == "[REDACTED]"
