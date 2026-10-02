"""`/api/v1/chat/conversation`, `/api/v1/chat/messages` and
`/api/v1/chat/actions/{id}/confirm|reject` (issues #39, #40, #41, spec
§10.1, §10.3, §10.4, §13.1).

Thin by design, matching `api.v1.settings` and `api.v1.archive`: this
module validates the request, resolves the effective model and timezone
(#31), delegates the tool-call loop to `ai.chat.send_chat_message`, and
every read/write to `db.chat_repository`/`db.chat_action_repository`. The
confirm/reject business rules (staleness, legal transitions, the shared
task write path) live entirely in `db.chat_action_repository.confirm`/
`reject` — this module only wires dependencies and lets the `ApiError` they
raise propagate to the standard error envelope.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from planora_api.ai.chat import send_chat_message
from planora_api.ai.chat_tools import PendingProposal
from planora_api.ai.client import LLMClient
from planora_api.ai.deps import get_llm_client
from planora_api.api.deps import (
    DbSession,
    get_current_time,
    get_settings,
    require_session,
)
from planora_api.config import Settings
from planora_api.db import chat_action_repository, chat_repository, settings_repository
from planora_api.db.models import (
    AuthSession,
    ChatAction,
    ChatActionKind,
    ChatMessage,
    ChatRole,
    Conversation,
)
from planora_api.errors import (
    AUTH_RESPONSES,
    ERROR_RESPONSE,
    VALIDATION_RESPONSE,
    WRITE_RESPONSES,
)
from planora_api.schemas.chat import (
    ChatActionFieldResponse,
    ChatActionResponse,
    ChatMessageResponse,
    ConversationResponse,
    SendMessageRequest,
)

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

_SEND_MESSAGE_RESPONSES = {
    **WRITE_RESPONSES,
    422: VALIDATION_RESPONSE,
    503: ERROR_RESPONSE,
}
_ACTION_RESPONSES = {
    **WRITE_RESPONSES,
    404: ERROR_RESPONSE,
    409: ERROR_RESPONSE,
    422: VALIDATION_RESPONSE,
}


def _action_response(action: ChatAction | None) -> ChatActionResponse | None:
    if action is None:
        return None
    return ChatActionResponse(
        id=action.id,
        kind=action.kind,
        title=action.title,
        summary=action.summary,
        fields=[
            ChatActionFieldResponse(label=f["label"], from_=f["from"], to=f["to"])
            for f in action.fields
        ],
        status=action.status,
        payload=action.payload,
    )


def _to_response(
    conversation: Conversation,
    messages: list[ChatMessage],
    actions_by_message_id: dict[uuid.UUID, ChatAction],
) -> ConversationResponse:
    return ConversationResponse(
        id=conversation.conversation_id,
        messages=[
            ChatMessageResponse(
                id=message.id,
                role=message.role,
                text=message.text,
                created_at=message.created_at,
                action=_action_response(actions_by_message_id.get(message.id)),
            )
            for message in messages
        ],
    )


def _current_conversation_response(db: Session, now: datetime) -> ConversationResponse:
    conversation = chat_repository.get_or_create_conversation(db, now=now)
    messages = chat_repository.list_messages(db)
    actions = chat_action_repository.list_actions_by_message_id(db)
    return _to_response(conversation, messages, actions)


@router.get(
    "/conversation", response_model=ConversationResponse, responses=AUTH_RESPONSES
)
def read_conversation(
    db: DbSession,
    now: Annotated[datetime, Depends(get_current_time)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> ConversationResponse:
    return _current_conversation_response(db, now)


@router.post(
    "/conversation",
    response_model=ConversationResponse,
    status_code=201,
    responses=WRITE_RESPONSES,
)
def reset_conversation(
    db: DbSession,
    now: Annotated[datetime, Depends(get_current_time)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> ConversationResponse:
    conversation = chat_repository.reset_conversation(db, now=now)
    return _to_response(conversation, [], {})


@router.post("/messages", response_model=ConversationResponse, responses=_SEND_MESSAGE_RESPONSES)
async def send_message(
    body: SendMessageRequest,
    request: Request,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_current_time)],
    llm: Annotated[LLMClient, Depends(get_llm_client)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> ConversationResponse:
    """Send one user message and return the full, updated conversation.

    No write happens before `send_chat_message` returns successfully — a
    failure anywhere in its tool-call loop (an `LLMUnavailableError`,
    surfaced as `503 AI_UNAVAILABLE` by `ai.client.register_llm_error_
    handler`) propagates straight out of this route, and `api.deps.get_db`
    rolls back the request's transaction, so neither the user turn, an
    assistant turn, nor any proposal is ever persisted (spec §10.4).

    Issue #41: the first proposal the turn produced (if any) is attached to
    the one assistant message that carries the model's final text; each
    further proposal gets its own assistant message with empty text, in
    call order — never a `task` row, which only a later confirm writes.
    """
    effective = settings_repository.get_effective_settings(db, settings)
    history = chat_repository.list_messages(db)
    actions_by_message_id = chat_action_repository.list_actions_by_message_id(db)

    turn = await send_chat_message(
        llm=llm,
        request=request,
        db=db,
        text=body.text,
        now=now,
        timezone_name=effective.timezone,
        model=effective.model_name,
        history=history,
        actions_by_message_id=actions_by_message_id,
    )

    chat_repository.append_message(db, role=ChatRole.USER, text=body.text, now=now)
    _persist_assistant_turn(db, text=turn.text, proposals=turn.proposals, now=now)

    return _current_conversation_response(db, now)


def _persist_assistant_turn(
    db: Session, *, text: str, proposals: list[PendingProposal], now: datetime
) -> None:
    first_message = chat_repository.append_message(db, role=ChatRole.ASSISTANT, text=text, now=now)
    if not proposals:
        return

    _persist_proposal(db, message_id=first_message.id, proposal=proposals[0], now=now)
    for proposal in proposals[1:]:
        extra_message = chat_repository.append_message(
            db, role=ChatRole.ASSISTANT, text="", now=now
        )
        _persist_proposal(db, message_id=extra_message.id, proposal=proposal, now=now)


def _persist_proposal(
    db: Session, *, message_id: uuid.UUID, proposal: PendingProposal, now: datetime
) -> None:
    chat_action_repository.create_action(
        db,
        message_id=message_id,
        kind=ChatActionKind(proposal.kind),
        title=proposal.title,
        summary=proposal.summary,
        fields=proposal.fields,
        payload=proposal.payload,
        task_id=proposal.task_id,
        stale_snapshot=proposal.stale_snapshot,
        changed_fields=proposal.changed_fields,
        now=now,
    )


@router.post(
    "/actions/{action_id}/confirm",
    response_model=ConversationResponse,
    responses=_ACTION_RESPONSES,
)
def confirm_action(
    action_id: uuid.UUID,
    db: DbSession,
    now: Annotated[datetime, Depends(get_current_time)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> ConversationResponse:
    """Apply a pending proposal's write (spec §41). Calls no LLM. Every
    documented failure (`404`, `409 ACTION_ALREADY_REJECTED`,
    `409 ACTION_STALE`) is raised by `db.chat_action_repository.confirm`
    itself and propagates unchanged through this route."""
    chat_action_repository.confirm(db, action_id, now=now)
    return _current_conversation_response(db, now)


@router.post(
    "/actions/{action_id}/reject",
    response_model=ConversationResponse,
    responses=_ACTION_RESPONSES,
)
def reject_action(
    action_id: uuid.UUID,
    db: DbSession,
    now: Annotated[datetime, Depends(get_current_time)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> ConversationResponse:
    """Reject a pending proposal (spec §41). Calls no LLM. The documented
    failures (`404 NOT_FOUND`, `409 ACTION_ALREADY_APPLIED`) are raised by
    `db.chat_action_repository.reject` itself."""
    chat_action_repository.reject(db, action_id, now=now)
    return _current_conversation_response(db, now)
