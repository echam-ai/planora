"""The chat tool-call loop (issue #40, spec §10.1, §10.4, §19.2).

`send_chat_message` builds one request's message list — the system prompt,
capped prior history, and the new user turn — then drives
`LLMClient.complete()` through up to `MAX_TOOL_CALLS` rounds, validating and
executing any tool call against `ai.chat_tools.TOOL_REGISTRY` before it is
ever run. It returns the assistant's final text and writes nothing itself;
`api.v1.chat.send_message` persists the user and assistant turns only after
this returns successfully (spec §10.4: "AI errors must ... not partially
apply mutations" — every raise here happens strictly before any write).
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Sequence
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Request
from pydantic import ValidationError
from sqlalchemy.orm import Session

from planora_api.ai.chat_tools import (
    TOOL_CALL_ERROR_RESULT,
    TOOL_DEFINITIONS,
    TOOL_REGISTRY,
)
from planora_api.ai.client import (
    LLMClient,
    LLMCompletion,
    LLMToolCall,
    LLMUnavailableError,
)
from planora_api.ai.deps import run_cancellable
from planora_api.ai.prompts import build_chat_system_prompt
from planora_api.db.models import ChatMessage, TaskCategory, TaskPriority, TaskStatus

logger = logging.getLogger("planora_api.ai.chat")

# A message makes at most this many `complete()` calls (issue #40
# acceptance: "at most 5 complete() calls"). If the last of them still
# requests a tool, or ends with empty/whitespace-only content, the whole
# send fails — see `send_chat_message` below.
MAX_TOOL_CALLS = 5

# Only the most recent prior turns are replayed on every request — capped
# so the prompt doesn't grow without bound over a long-lived conversation.
# Tool-call/tool-result messages from *earlier* turns are never persisted
# in the first place (`db.chat_repository` stores only user/assistant
# text), so there is nothing of that kind to resend here either.
_MAX_HISTORY_MESSAGES = 20

_DEADLINE_STATE_VALUES = ("none", "scheduled", "due_soon", "overdue")


def _build_system_prompt(*, now: datetime, timezone_name: str) -> str:
    local_now = now.astimezone(ZoneInfo(timezone_name))
    return build_chat_system_prompt(
        current_date=local_now.strftime("%Y-%m-%d"),
        current_time=local_now.strftime("%H:%M"),
        current_weekday=local_now.strftime("%A"),
        timezone_name=timezone_name,
        statuses=[member.value for member in TaskStatus],
        categories=[member.value for member in TaskCategory],
        priorities=[member.value for member in TaskPriority],
        deadline_states=list(_DEADLINE_STATE_VALUES),
    )


def _build_initial_messages(
    *, system_prompt: str, history: Sequence[ChatMessage], text: str
) -> list[dict[str, Any]]:
    """`[system, ...capped prior turns, new user turn]` — the prior turns
    keep their own persisted `role`/`text` unchanged; the new user turn is
    its own message, never concatenated into the system prompt or any
    delimited block (see `ai.prompts`'s chat-prompt docstring)."""
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for message in history[-_MAX_HISTORY_MESSAGES:]:
        messages.append({"role": message.role.value, "content": message.text})
    messages.append({"role": "user", "content": text})
    return messages


def _assistant_tool_call_message(completion: LLMCompletion) -> dict[str, Any]:
    return {
        "role": "assistant",
        "content": completion.content,
        "tool_calls": [
            {
                "id": call.id,
                "type": "function",
                "function": {"name": call.name, "arguments": call.arguments_json},
            }
            for call in completion.tool_calls
        ],
    }


def _execute_tool_call(
    db: Session, tool_call: LLMToolCall, *, now: datetime, timezone_name: str
) -> dict[str, Any]:
    """Validate `tool_call` against its server-side schema and execute it
    only if that passes (spec §10.4: "tool calls must be validated against
    server-side schemas before use"). An unknown tool name, invalid JSON,
    or a schema-failing set of arguments returns the same fixed error body
    and is never executed — never even reaching `TOOL_REGISTRY`'s
    executor."""
    started = time.perf_counter()
    spec = TOOL_REGISTRY.get(tool_call.name)
    if spec is None:
        _log_tool_call(tool_call.name, outcome="unknown_tool", count=None, started=started)
        return TOOL_CALL_ERROR_RESULT

    try:
        raw_arguments = json.loads(tool_call.arguments_json)
        args = spec.args_model.model_validate(raw_arguments)
    except (ValueError, ValidationError):
        _log_tool_call(tool_call.name, outcome="invalid_arguments", count=None, started=started)
        return TOOL_CALL_ERROR_RESULT

    result = spec.executor(db, args, now, timezone_name)
    _log_tool_call(
        tool_call.name, outcome="success", count=len(result.get("tasks", [])), started=started
    )
    return result


def _log_tool_call(name: str, *, outcome: str, count: int | None, started: float) -> None:
    logger.info(
        "chat_tool_call",
        extra={
            "tool": name,
            "outcome": outcome,
            "count": count,
            "duration_ms": round((time.perf_counter() - started) * 1000, 3),
        },
    )


async def send_chat_message(
    *,
    llm: LLMClient,
    request: Request,
    db: Session,
    text: str,
    now: datetime,
    timezone_name: str,
    model: str,
    history: Sequence[ChatMessage],
) -> str:
    """Run one user message through the tool-call loop and return the
    assistant's final text. Raises `LLMUnavailableError` for every failure
    mode (a real LLM failure, the loop bound reached while still
    requesting tools, or a final completion with empty/whitespace-only
    content) — `api.v1.chat.send_message` never sees a partial result and
    persists nothing when this raises.

    Every `complete()` call passes `model` (the caller's already-resolved
    effective model name, resolved fresh per request — issue #37/#31) and
    the fixed `ai.chat_tools.TOOL_DEFINITIONS`. Tool results reach the
    model only as `role: "tool"` messages; nothing here ever writes to the
    database — `TOOL_REGISTRY`'s two executors are both read-only.
    """
    system_prompt = _build_system_prompt(now=now, timezone_name=timezone_name)
    messages = _build_initial_messages(system_prompt=system_prompt, history=history, text=text)

    for call_number in range(1, MAX_TOOL_CALLS + 1):
        completion = await run_cancellable(
            request, llm.complete(messages, model=model, tools=TOOL_DEFINITIONS)
        )

        if completion.tool_calls:
            if call_number == MAX_TOOL_CALLS:
                # The loop bound is reached and the model still wants a
                # tool — no further completion will ever consume a result,
                # so these calls are not executed at all.
                raise LLMUnavailableError("invalid_response") from None
            messages.append(_assistant_tool_call_message(completion))
            for tool_call in completion.tool_calls:
                result = _execute_tool_call(db, tool_call, now=now, timezone_name=timezone_name)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": json.dumps(result),
                    }
                )
            continue

        final_text = (completion.content or "").strip()
        if not final_text:
            raise LLMUnavailableError("invalid_response") from None
        return final_text

    # Unreachable: the loop above always either `return`s or `raise`s by
    # the time `call_number == MAX_TOOL_CALLS` is processed.
    raise LLMUnavailableError("invalid_response") from None  # pragma: no cover
