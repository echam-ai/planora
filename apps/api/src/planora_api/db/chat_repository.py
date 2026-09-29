"""Repository functions for the single `conversation` row and its
`chat_message` rows (issue #39, spec §10.3).

Mirrors `db/settings_repository.py`'s single-row shape for `app_settings`:
`get_or_create_conversation` lazily creates the one allowed row, keyed by
the fixed id `1` (the `CHECK (id = 1)` constraint allows no other value).
`reset_conversation` replaces the wire-visible `conversation_id` with a
fresh UUID and deletes every message — the reset the acceptance criteria
call "not an audit log": task changes already confirmed stay untouched,
only chat history is wiped. `append_message` is exposed here, not behind
its own route, because this issue adds no `POST /chat/messages` route —
that belongs to #40, which will call this same function.

Every function takes an already-open `Session` and never commits, matching
`db/task_repository.py` and `db/settings_repository.py` — the request-scoped
`get_db` dependency commits exactly once, after the route returns.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from planora_api.db.models import ChatMessage, ChatRole, Conversation

# `conversation.id` is always 1 — the table's `CHECK (id = 1)` constraint
# allows no other value (mirrors `settings_repository._SINGLE_SETTINGS_ID`).
_SINGLE_CONVERSATION_ID = 1


def get_or_create_conversation(db: Session, *, now: datetime) -> Conversation:
    """Return the single conversation row, creating it with a fresh
    `conversation_id` on first use. Read-only after that first call —
    a `GET` never changes the stored `conversation_id`."""
    conversation = db.get(Conversation, _SINGLE_CONVERSATION_ID)
    if conversation is None:
        conversation = Conversation(
            id=_SINGLE_CONVERSATION_ID,
            conversation_id=uuid.uuid4(),
            created_at=now,
            updated_at=now,
        )
        db.add(conversation)
        db.flush()
    return conversation


def list_messages(db: Session) -> list[ChatMessage]:
    """Every message in the single conversation, in append order.

    Ordered by `sequence`, the counter `append_message` assigns itself —
    not by `created_at`, which two messages may share exactly (the
    acceptance criteria require append order to survive that tie).
    """
    stmt = select(ChatMessage).order_by(ChatMessage.sequence)
    return list(db.execute(stmt).scalars().all())


def reset_conversation(db: Session, *, now: datetime) -> Conversation:
    """Replace the single conversation with a brand-new one: every message
    row is deleted (not hidden or orphaned — there is nothing left for a
    later message to orphan into, since a message carries no foreign key
    back to a conversation), and the stored `conversation_id` is replaced
    with a fresh UUID so a subsequent read returns a different `id`.

    Every task row is untouched — this function never queries `task`.
    """
    db.execute(delete(ChatMessage))
    conversation = get_or_create_conversation(db, now=now)
    conversation.conversation_id = uuid.uuid4()
    conversation.updated_at = now
    db.flush()
    return conversation


def append_message(
    db: Session, *, role: ChatRole, text: str, now: datetime
) -> ChatMessage:
    """Append one message to the single conversation, creating the
    conversation row first if this is the very first message.

    `sequence` is one greater than the current maximum (`0` if the table is
    empty), assigned here in Python rather than through a database
    autoincrement column, so the same ordering behavior holds on SQLite and
    PostgreSQL with no model fork (binding rule 4) and needs no database
    round-trip after the insert to learn the assigned value.
    """
    get_or_create_conversation(db, now=now)
    next_sequence = (db.execute(select(func.max(ChatMessage.sequence))).scalar_one_or_none() or 0) + 1
    message = ChatMessage(
        id=uuid.uuid4(), sequence=next_sequence, role=role, text=text, created_at=now
    )
    db.add(message)
    db.flush()
    return message
