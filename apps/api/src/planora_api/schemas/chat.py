"""Wire schemas for `/api/v1/chat/conversation` (spec §10.3, §13.1, issue
#39).

`snake_case` field names, matching the wire contract exactly (binding rule
2) and the web tier's `Conversation` shape in
`apps/web/src/shared/domain/chat.ts` minus the per-message `action` field,
which belongs to #41. There is no request body schema here: `GET` takes
none, and `POST` (reset) takes none either — the decision recorded on the
issue is that reset is a bare `POST` on the same path.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from planora_api.db.models import ChatRole


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
