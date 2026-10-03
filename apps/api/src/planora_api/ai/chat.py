"""The chat tool-call loop (issue #40, #41, spec §10.1, §10.4, §19.2).

`send_chat_message` builds one request's message list — the system prompt,
capped prior history, and the new user turn — then drives
`LLMClient.complete()` through up to `MAX_TOOL_CALLS` rounds, validating and
executing any tool call against the combined `TOOL_REGISTRY` below (the two
read tools from `ai.chat_tools` plus the four proposal tools from
`ai.propose_tools`) before it is ever run. It returns the assistant's final
text *and* every proposal the turn produced (issue #41's
`ChatTurnResult.proposals`), and writes nothing itself — not even a
proposal, despite each one having already been fully validated and computed
by the time this function returns successfully.
`api.v1.chat.send_message` persists the user turn, the assistant turn(s)
and any proposal only after this returns successfully (spec §10.4: "AI
errors must ... not partially apply mutations" — every raise here happens
strictly before any write, and a later round's failure discards this
function's whole in-memory `proposals` list along with everything else).
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Request
from pydantic import ValidationError
from sqlalchemy.orm import Session

from planora_api.ai import chat_tools, propose_tools
from planora_api.ai.chat_tools import (
    DEADLINE_STATE_VALUES,
    TOOL_CALL_ERROR_RESULT,
    PendingProposal,
    ToolSpec,
)
from planora_api.ai.client import (
    LLMClient,
    LLMCompletion,
    LLMToolCall,
    LLMUnavailableError,
)
from planora_api.ai.deps import run_cancellable
from planora_api.ai.prompts import build_chat_system_prompt
from planora_api.db.models import (
    ChatAction,
    ChatMessage,
    TaskCategory,
    TaskPriority,
    TaskStatus,
)

logger = logging.getLogger("planora_api.ai.chat")

# A message makes at most this many `complete()` calls (issue #40
# acceptance: "at most 5 complete() calls"). If the last of them still
# requests a tool, or ends with empty/whitespace-only content, the whole
# send fails — see `send_chat_message` below.
MAX_TOOL_CALLS = 5

# spec §41: "One POST /chat/messages can produce at most 5 proposals."
# Independent of `MAX_TOOL_CALLS` above — a turn can make several
# non-proposal tool calls (`find_active_tasks`, `search_archive`) without
# ever approaching this limit, and a proposal call past this limit gets
# `{"error": "too_many_proposals"}` rather than counting toward the
# `MAX_TOOL_CALLS` round budget being exhausted.
MAX_PROPOSALS = 5

# The full tool surface this turn's `complete()` calls advertise: the two
# read tools (issue #40) plus the four proposal tools (issue #41). Combined
# here, not in either source module, so `ai.chat_tools` and
# `ai.propose_tools` each stay independently testable and neither imports
# the other.
TOOL_REGISTRY: dict[str, ToolSpec] = {**chat_tools.TOOL_REGISTRY, **propose_tools.TOOL_REGISTRY}
TOOL_DEFINITIONS: tuple[Mapping[str, Any], ...] = tuple(
    spec.definition for spec in TOOL_REGISTRY.values()
)

# Only the most recent prior turns are replayed on every request — capped
# so the prompt doesn't grow without bound over a long-lived conversation.
# Tool-call/tool-result messages from *earlier* turns are never persisted
# in the first place (`db.chat_repository` stores only user/assistant
# text), so there is nothing of that kind to resend here either.
MAX_HISTORY_MESSAGES = 20


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
        deadline_states=list(DEADLINE_STATE_VALUES),
    )


def _history_content(message: ChatMessage, action: ChatAction | None) -> str:
    """The text one prior turn replays as, for the model (spec §41:
    "Replayed history covers each earlier proposal's kind, summary and
    current status. It never includes `content`, `markdown_note` or
    `urls`" — so this reads only `action.kind`/`.summary`/`.status`, never
    `.payload` or `.fields`, which is where those forbidden values live).
    A message with no action replays exactly as persisted."""
    if action is None:
        return message.text
    summary = f"[Proposed {action.kind.value}: {action.summary} (status: {action.status.value})]"
    return f"{message.text}\n{summary}" if message.text else summary


def _build_initial_messages(
    *,
    system_prompt: str,
    history: Sequence[ChatMessage],
    actions_by_message_id: Mapping[Any, ChatAction],
    text: str,
) -> list[dict[str, Any]]:
    """`[system, ...capped prior turns, new user turn]` — the prior turns
    keep their own persisted `role` unchanged and replay through
    `_history_content` (unchanged for a plain message; annotated with the
    proposal's kind/summary/status for one that carried an action). The new
    user turn is its own message, never concatenated into the system
    prompt or any delimited block (see `ai.prompts`'s chat-prompt
    docstring)."""
    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for message in history[-MAX_HISTORY_MESSAGES:]:
        content = _history_content(message, actions_by_message_id.get(message.id))
        messages.append({"role": message.role.value, "content": content})
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
    db: Session,
    tool_call: LLMToolCall,
    *,
    now: datetime,
    timezone_name: str,
    proposals: list[PendingProposal],
) -> dict[str, Any]:
    """Validate `tool_call` against its server-side schema and execute it
    only if that passes (spec §10.4: "tool calls must be validated against
    server-side schemas before use"). An unknown tool name, invalid JSON,
    or a schema-failing set of arguments returns the same fixed error body
    and is never executed — never even reaching `TOOL_REGISTRY`'s
    executor.

    A `propose_*` call once `len(proposals)` has already reached
    `MAX_PROPOSALS` gets `{"error": "too_many_proposals"}` before its
    arguments are even parsed (spec §41) — this counts only proposals this
    turn actually produced, never merely-attempted calls, so an invalid or
    no-op `propose_*` call never itself counts against the cap. A
    successful `propose_*` call appends its `PendingProposal` to
    `proposals` (mutated in place) and still returns only
    `{"status": "pending_confirmation"}` to the model — never the
    proposal's own content.
    """
    started = time.perf_counter()
    spec = TOOL_REGISTRY.get(tool_call.name)
    if spec is None:
        _log_tool_call(tool_call.name, outcome="unknown_tool", count=None, started=started)
        return TOOL_CALL_ERROR_RESULT

    if tool_call.name in propose_tools.PROPOSAL_TOOL_NAMES and len(proposals) >= MAX_PROPOSALS:
        _log_tool_call(tool_call.name, outcome="too_many_proposals", count=None, started=started)
        return {"error": "too_many_proposals"}

    try:
        raw_arguments = json.loads(tool_call.arguments_json)
        args = spec.args_model.model_validate(raw_arguments)
    except (ValueError, ValidationError):
        _log_tool_call(tool_call.name, outcome="invalid_arguments", count=None, started=started)
        return TOOL_CALL_ERROR_RESULT

    execution = spec.executor(db, args, now, timezone_name)
    if execution.proposal is not None:
        proposals.append(execution.proposal)
    outcome = "proposed" if execution.proposal is not None else "success"
    _log_tool_call(
        tool_call.name,
        outcome=outcome,
        count=len(execution.tool_result.get("tasks", []))
        if "tasks" in execution.tool_result
        else None,
        started=started,
    )
    return execution.tool_result


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


@dataclass(frozen=True)
class ChatTurnResult:
    """One `send_chat_message` call's full result (issue #41): the
    assistant's final text, and every proposal the turn produced, in the
    order the model called them — never yet persisted (see the module
    docstring)."""

    text: str
    proposals: list[PendingProposal]


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
    actions_by_message_id: Mapping[Any, ChatAction],
) -> ChatTurnResult:
    """Run one user message through the tool-call loop and return the
    assistant's final text plus any proposals it made. Raises
    `LLMUnavailableError` for every failure mode (a real LLM failure, the
    loop bound reached while still requesting tools, or a final completion
    with empty/whitespace-only content) — `api.v1.chat.send_message` never
    sees a partial result and persists nothing when this raises.

    `actions_by_message_id` (from `db.chat_action_repository.
    list_actions_by_message_id`) is how `_build_initial_messages` replays
    an earlier proposal's kind/summary/status in history without ever
    replaying the task content, markdown note or URLs behind it (spec
    §41).

    Every `complete()` call passes `model` (the caller's already-resolved
    effective model name, resolved fresh per request — issue #37/#31) and
    the fixed `TOOL_DEFINITIONS` (the two read tools plus the four
    proposal tools). Tool results reach the model only as `role: "tool"`
    messages; nothing here ever writes to the database — every executor in
    `TOOL_REGISTRY` is read-only, proposal tools included (see
    `ai.propose_tools`'s module docstring).
    """
    system_prompt = _build_system_prompt(now=now, timezone_name=timezone_name)
    messages = _build_initial_messages(
        system_prompt=system_prompt,
        history=history,
        actions_by_message_id=actions_by_message_id,
        text=text,
    )
    proposals: list[PendingProposal] = []

    for call_number in range(1, MAX_TOOL_CALLS + 1):
        # Nothing has been written yet (every executor is read-only), so
        # ending the transaction the reads auto-began is a pure release of
        # the pooled connection — never held "idle in transaction" across
        # the LLM round trip (issue #121).
        if db.in_transaction():
            db.rollback()
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
                result = _execute_tool_call(
                    db, tool_call, now=now, timezone_name=timezone_name, proposals=proposals
                )
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
        return ChatTurnResult(text=final_text, proposals=proposals)

    # Unreachable: the loop above always either `return`s or `raise`s by
    # the time `call_number == MAX_TOOL_CALLS` is processed.
    raise LLMUnavailableError("invalid_response") from None  # pragma: no cover
