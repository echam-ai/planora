"""`/api/v1/chat/conversation` — read and reset the single current
conversation (issue #39, spec §10.3, §13.1).

Thin by design, matching `api.v1.settings` and `api.v1.archive`: this
module validates the request (there is nothing to validate — neither route
takes a body), delegates every read/write to `db.chat_repository`, and
shapes the response. It adds no `POST /chat/messages` route; that route,
and the per-message `action` field, belong to #40 and #41, which will call
`db.chat_repository.append_message` from their own router.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends

from planora_api.api.deps import DbSession, get_current_time, require_session
from planora_api.db import chat_repository
from planora_api.db.models import AuthSession, ChatMessage, Conversation
from planora_api.errors import ERROR_RESPONSE
from planora_api.schemas.chat import ChatMessageResponse, ConversationResponse

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

_AUTH_RESPONSES = {401: ERROR_RESPONSE}
_WRITE_RESPONSES = {**_AUTH_RESPONSES, 403: ERROR_RESPONSE}


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
