"""`/api/v1/chat/conversation` and `/api/v1/chat/messages` (issues #39,
#40, spec §10.1, §10.3, §10.4, §13.1).

Thin by design, matching `api.v1.settings` and `api.v1.archive`: this
module validates the request, resolves the effective model and timezone
(#31), delegates the tool-call loop to `ai.chat.send_chat_message`, and
every read/write to `db.chat_repository`. It adds no per-message `action`
field or confirm/reject route; those belong to #41.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from planora_api.ai.chat import send_chat_message
from planora_api.ai.client import LLMClient
from planora_api.ai.deps import get_llm_client
from planora_api.api.deps import (
    DbSession,
    get_current_time,
    get_settings,
    require_session,
)
from planora_api.config import Settings
from planora_api.db import chat_repository, settings_repository
from planora_api.db.models import AuthSession, ChatMessage, ChatRole, Conversation
from planora_api.errors import ERROR_RESPONSE, VALIDATION_RESPONSE
from planora_api.schemas.chat import (
    ChatMessageResponse,
    ConversationResponse,
    SendMessageRequest,
)

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

_AUTH_RESPONSES = {401: ERROR_RESPONSE}
_WRITE_RESPONSES = {**_AUTH_RESPONSES, 403: ERROR_RESPONSE}
_SEND_MESSAGE_RESPONSES = {
    **_WRITE_RESPONSES,
    422: VALIDATION_RESPONSE,
    503: ERROR_RESPONSE,
}


def _to_response(
    conversation: Conversation, messages: list[ChatMessage]
) -> ConversationResponse:
    return ConversationResponse(
        id=conversation.conversation_id,
        messages=[ChatMessageResponse.model_validate(message) for message in messages],
    )


@router.get(
    "/conversation", response_model=ConversationResponse, responses=_AUTH_RESPONSES
)
def read_conversation(
    db: DbSession,
    now: Annotated[datetime, Depends(get_current_time)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> ConversationResponse:
    conversation = chat_repository.get_or_create_conversation(db, now=now)
    messages = chat_repository.list_messages(db)
    return _to_response(conversation, messages)


@router.post(
    "/conversation",
    response_model=ConversationResponse,
    status_code=201,
    responses=_WRITE_RESPONSES,
)
def reset_conversation(
    db: DbSession,
    now: Annotated[datetime, Depends(get_current_time)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> ConversationResponse:
    conversation = chat_repository.reset_conversation(db, now=now)
    return _to_response(conversation, [])


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
    rolls back the request's transaction, so neither the user turn nor an
    assistant turn is ever persisted (spec §10.4).
    """
    effective = settings_repository.get_effective_settings(db, settings)
    history = chat_repository.list_messages(db)

    assistant_text = await send_chat_message(
        llm=llm,
        request=request,
        db=db,
        text=body.text,
        now=now,
        timezone_name=effective.timezone,
        model=effective.model_name,
        history=history,
    )

    chat_repository.append_message(db, role=ChatRole.USER, text=body.text, now=now)
    chat_repository.append_message(db, role=ChatRole.ASSISTANT, text=assistant_text, now=now)

    conversation = chat_repository.get_or_create_conversation(db, now=now)
    messages = chat_repository.list_messages(db)
    return _to_response(conversation, messages)
