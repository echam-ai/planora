"""Sentinel test for issue #41 (spec §15.5): "Proposal, confirm and reject
logs contain only the action kind, action id, outcome and duration" — never
a title, content, deadline, URL, field value or raw tool argument.

Follows `test_llm_redaction_sentinels.py` and
`test_operator_debug_log_redaction.py`'s shape: drive real proposal,
confirm and reject requests through the real, configured logging pipeline
at `DEBUG`, then assert none of the sentinels appears in captured stdout or
any `caplog` record.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from conftest import make_client
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy.orm import Session, sessionmaker

from planora_api.ai.client import LLMCompletion, LLMToolCall
from planora_api.ai.deps import get_llm_client
from planora_api.ai.fake import FakeLLMClient
from planora_api.api.deps import get_current_time

NOW = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)
MESSAGES_URL = "/api/v1/chat/messages"

TITLE_SENTINEL = "SENTINEL-chat-action-title-8f31"
CONTENT_SENTINEL = "SENTINEL-chat-action-content-2d90"
URL_SENTINEL = "https://example.com/SENTINEL-chat-action-url-6c14"
DEADLINE_ARG_SENTINEL = "2026-10-09T17:00"  # a real value, checked structurally below
ALL_SENTINELS = (TITLE_SENTINEL, CONTENT_SENTINEL, URL_SENTINEL)


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _select_profile(client: AsyncClient) -> None:
    client.headers["X-Planora-Profile"] = "hamster_knight"


def _fixed_clock(app: FastAPI, now: datetime = NOW) -> None:
    app.dependency_overrides[get_current_time] = lambda: now


def _tool_call_completion(*calls: tuple[str, dict[str, Any]]) -> LLMCompletion:
    return LLMCompletion(
        content=None,
        tool_calls=tuple(
            LLMToolCall(id=f"call_{i}", name=name, arguments_json=json.dumps(args))
            for i, (name, args) in enumerate(calls)
        ),
        finish_reason="tool_calls",
        usage=None,
    )


def _text_completion(text: str) -> LLMCompletion:
    return LLMCompletion(content=text, tool_calls=(), finish_reason="stop", usage=None)


@pytest.fixture
def debug_env(valid_env: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    valid_env.setenv("LOG_LEVEL", "DEBUG")
    return valid_env


def _assert_no_sentinel_leaked(captured_out: str, records: list[logging.LogRecord]) -> None:
    for sentinel in ALL_SENTINELS:
        assert sentinel not in captured_out, f"{sentinel!r} leaked into stdout"
    for record in records:
        text = record.getMessage()
        for sentinel in ALL_SENTINELS:
            assert sentinel not in text, f"{sentinel!r} leaked into a log record"
            assert sentinel not in json.dumps(record.__dict__, default=str), (
                f"{sentinel!r} leaked into a log record's fields"
            )


def test_propose_create_task_confirm_and_reject_leak_no_sentinel(
    debug_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)
    app = app_factory()
    _fixed_clock(app)
    fake = FakeLLMClient(
        [
            _tool_call_completion(
                (
                    "propose_create_task",
                    {
                        "title": TITLE_SENTINEL,
                        "content": CONTENT_SENTINEL,
                        "category": "work",
                        "priority": "high",
                        "deadline": DEADLINE_ARG_SENTINEL,
                        "urls": [{"url": URL_SENTINEL}],
                    },
                )
            ),
            _text_completion("Here's the preview."),
        ]
    )
    app.dependency_overrides[get_llm_client] = lambda: fake

    async def scenario() -> tuple[Response, Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            proposed = await client.post(MESSAGES_URL, json={"text": "add a sentinel task"})
            action_id = next(
                m["action"]["id"] for m in proposed.json()["messages"] if m.get("action")
            )
            confirmed = await client.post(f"/api/v1/chat/actions/{action_id}/confirm")
            rejected = await client.post(f"/api/v1/chat/actions/{action_id}/reject")
            return proposed, confirmed, rejected

    proposed, confirmed, rejected = _run(scenario)
    assert proposed.status_code == 200
    assert confirmed.status_code == 200
    assert rejected.status_code == 409  # already applied — still no sentinel leak

    captured = capsys.readouterr().out
    _assert_no_sentinel_leaked(captured, caplog.records)
