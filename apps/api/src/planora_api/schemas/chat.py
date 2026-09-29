"""Wire schemas for `/api/v1/chat/conversation` and `/api/v1/chat/messages`
(spec §10.3, §13.1, §10.1-§10.4, issues #39, #40, #41).

`snake_case` field names, matching the wire contract exactly (binding rule
2) and the web tier's `Conversation`/`ChatAction` shapes in
`apps/web/src/shared/domain/chat.ts`. `GET /chat/conversation` and `POST
/chat/conversation` (reset) take no body; `POST /chat/messages` (#40) takes
`SendMessageRequest` below; confirm/reject (#41) take no body either.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from planora_api.db.models import ChatActionKind, ChatActionStatus, ChatRole

_TEXT_MIN_LENGTH = 1
_TEXT_MAX_LENGTH = 4000


class ChatActionFieldResponse(BaseModel):
    """One `{label, from, to}` preview entry (spec §41). `from` is a
    reserved Python keyword, so the attribute is `from_`, populated either
    by that name or by its wire alias `from` — FastAPI's default
    `response_model_by_alias=True` always serializes it as `from`."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    label: str
    from_: str | None = Field(default=None, alias="from")
    to: str


class ChatActionResponse(BaseModel):
    """One proposed action, attached to the assistant message that carries
    it (spec §41). `payload` is a kind-specific dict — `{"draft": ...}` for
    `create`, `{"task_id": ..., "draft": ...}` for `update`, `{"task_id":
    ..., "status": ...}` for `move`, `{"task_id": ..., "deadline_at": ...}`
    for `schedule` — built once at proposal time by `ai.propose_tools` and
    stored verbatim; this schema does not re-derive it."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    kind: ChatActionKind
    title: str
    summary: str
    fields: list[ChatActionFieldResponse]
    status: ChatActionStatus
    payload: dict[str, Any]


class ChatMessageResponse(BaseModel):
    """One message on the wire — `id`, `role`, `text`, `created_at`, and
    `action` (spec §41: `null` on a user message, on an assistant message
    with no proposal, and on a confirmation message; otherwise the
    proposal it carries)."""

    model_config = ConfigDict(extra="forbid")

    id: UUID
    role: ChatRole
    text: str
    created_at: datetime
    action: ChatActionResponse | None = None


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
