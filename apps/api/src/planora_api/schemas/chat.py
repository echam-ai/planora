"""Wire schemas for `/api/v1/chat/conversation` and `/api/v1/chat/messages`
(spec §10.3, §13.1, issues #39, #40).

`snake_case` field names, matching the wire contract exactly (binding rule
2) and the web tier's `Conversation` shape in
`apps/web/src/shared/domain/chat.ts` minus the per-message `action` field,
which belongs to #41. `GET /chat/conversation` and `POST /chat/conversation`
(reset) take no body; `POST /chat/messages` (#40) takes `SendMessageRequest`
below.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from planora_api.db.models import ChatRole

_TEXT_MIN_LENGTH = 1
_TEXT_MAX_LENGTH = 4000


class ChatMessageResponse(BaseModel):
    """One message on the wire — exactly `id`, `role`, `text` and
    `created_at`. No `action` field here; #41 adds it."""

    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    role: ChatRole
    text: str
    created_at: datetime


class ConversationResponse(BaseModel):
    """The full conversation wire shape — exactly `id` and `messages`."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    messages: list[ChatMessageResponse]


class SendMessageRequest(BaseModel):
    """`POST /api/v1/chat/messages` request body (issue #40). `text` is
    required to be 1 to 4000 characters *after* trimming — the same rule
    `schemas.ai.ParseTaskRequest` uses — and the trimmed value is what is
    persisted and sent to the model. An extra field, a missing field, a
    blank value, or an over-length value is rejected here, before the
    model is ever called and before any row is written."""

    model_config = ConfigDict(extra="forbid")

    text: str

    @field_validator("text")
    @classmethod
    def _text_is_1_to_4000_chars_after_trimming(cls, value: str) -> str:
        stripped = value.strip()
        if not (_TEXT_MIN_LENGTH <= len(stripped) <= _TEXT_MAX_LENGTH):
            raise ValueError(
                f"text must be {_TEXT_MIN_LENGTH} to {_TEXT_MAX_LENGTH} "
                "characters after trimming"
            )
        return stripped
