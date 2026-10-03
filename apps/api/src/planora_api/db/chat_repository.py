"""Repository functions for the single `conversation` row and its
`chat_message` rows (issue #39, spec §10.3).

Mirrors `db/settings_repository.py`'s single-row shape for `app_settings`:
`get_or_create_conversation` lazily creates the one allowed row, keyed by
the fixed id `1` (the `CHECK (id = 1)` constraint allows no other value).
`reset_conversation` replaces the wire-visible `conversation_id` with a
fresh UUID and deletes every message — the reset the acceptance criteria
call "not an audit log": task changes already confirmed stay untouched,
only chat history is wiped. `append_message` backs `POST /chat/messages`
(#40) as well as any future write tool's confirmation (#41).

Every function takes an already-open `Session` and never commits, matching
`db/task_repository.py` and `db/settings_repository.py` — the request-scoped
`get_db` dependency commits exactly once, after the route returns.

**Concurrency** (carried forward from #39's PM acceptance note; issue #40
acceptance). Two requests can race on the single-row `conversation` insert
(both see no row, both try to create one) or on `chat_message.sequence`
(both compute the same "next" value from a read taken before the other's
write lands). Both `get_or_create_conversation` and `append_message` retry
on `IntegrityError` — from inside a `SAVEPOINT` (`Session.begin_nested`),
so only the failed insert rolls back, not the caller's whole transaction —
re-reading the now-committed-by-the-other-request state instead of
propagating a `500`. `_insert_conversation`/`_insert_message` are split out
as their own functions purely as the seam a test monkeypatches to inject a
competing write deterministically, immediately before the real insert
runs — the same pattern `jobs.archive_done_tasks._archive_one` already
uses for its own race test.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from planora_api.db.models import ChatAction, ChatMessage, ChatRole, Conversation
from planora_api.db.profile import profile_id

# `append_message` retries at most this many times on a `sequence`
# collision before giving up. Each retry re-reads the current maximum, so
# exhausting this needs that many genuinely concurrent writers to keep
# landing in the same narrow window — never approached by a single-user
# application.
_MAX_APPEND_RETRIES = 5


def _insert_conversation(db: Session, *, now: datetime) -> Conversation:
    """The actual `INSERT` for a fresh conversation row — see the module
    docstring's "Concurrency" section for why this is its own function."""
    conversation = Conversation(
        id=profile_id(db),
        conversation_id=uuid.uuid4(),
        created_at=now,
        updated_at=now,
    )
    db.add(conversation)
    db.flush()
    return conversation


def get_or_create_conversation(db: Session, *, now: datetime) -> Conversation:
    """Return the profile conversation row, creating it with a fresh
    `conversation_id` on first use. Read-only after that first call —
    a `GET` never changes the stored `conversation_id`.

    If a concurrent request wins the race to create the row first, the
    `CHECK (id = 1)`/primary-key insert here raises `IntegrityError`
    (caught, from inside a savepoint so nothing else on this session's
    transaction rolls back with it), and this simply re-reads the row the
    other request just committed rather than propagating a `500`.
    """
    conversation = db.get(Conversation, profile_id(db))
    if conversation is not None:
        return conversation
    try:
        with db.begin_nested():
            conversation = _insert_conversation(db, now=now)
    except IntegrityError:
        conversation = db.get(Conversation, profile_id(db))
        assert conversation is not None, (
            "IntegrityError on the profile conversation row implies a "
            "concurrent insert committed it"
        )
    return conversation


def list_messages(db: Session) -> list[ChatMessage]:
    """Every message in the single conversation, in append order.

    Ordered by `sequence`, the counter `append_message` assigns itself —
    not by `created_at`, which two messages may share exactly (the
    acceptance criteria require append order to survive that tie).
    """
    stmt = select(ChatMessage).where(ChatMessage.profile_id == profile_id(db)).order_by(ChatMessage.sequence)
    return list(db.execute(stmt).scalars().all())


def list_recent_messages(db: Session, *, limit: int) -> list[ChatMessage]:
    """The last `limit` messages, in ascending `sequence` order — a bounded
    read (`ORDER BY sequence DESC LIMIT n`, reversed) for the LLM history
    window, so a long conversation is never loaded whole (issue #121)."""
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.profile_id == profile_id(db))
        .order_by(ChatMessage.sequence.desc())
        .limit(limit)
    )
    return list(reversed(db.execute(stmt).scalars().all()))


def reset_conversation(db: Session, *, now: datetime) -> Conversation:
    """Replace the single conversation with a brand-new one: every message
    row is deleted (not hidden or orphaned — there is nothing left for a
    later message to orphan into, since a message carries no foreign key
    back to a conversation), and the stored `conversation_id` is replaced
    with a fresh UUID so a subsequent read returns a different `id`. Every
    `chat_action` row is deleted along with its message (issue #41) —
    neither table has a foreign key to the other, so this bulk delete is
    what makes a reset-removed action's id 404 on a later confirm/reject,
    not database-enforced cascade.

    Every task row is untouched — this function never queries `task`.
    """
    db.execute(delete(ChatAction).where(ChatAction.profile_id == profile_id(db)))
    db.execute(delete(ChatMessage).where(ChatMessage.profile_id == profile_id(db)))
    conversation = get_or_create_conversation(db, now=now)
    conversation.conversation_id = uuid.uuid4()
    conversation.updated_at = now
    db.flush()
    return conversation


def _next_sequence(db: Session) -> int:
    return (db.execute(select(func.max(ChatMessage.sequence)).where(ChatMessage.profile_id == profile_id(db))).scalar_one_or_none() or 0) + 1


def _insert_message(
    db: Session, *, role: ChatRole, text: str, now: datetime, sequence: int
) -> ChatMessage:
    """The actual `INSERT` for one message at `sequence` — see the module
    docstring's "Concurrency" section for why this is its own function."""
    message = ChatMessage(
        id=uuid.uuid4(), profile_id=profile_id(db), sequence=sequence, role=role, text=text, created_at=now
    )
    db.add(message)
    db.flush()
    return message


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

    If a concurrent request's insert lands at the same `sequence` first,
    `uq_chat_message_sequence` raises `IntegrityError` (caught, from
    inside a savepoint); this re-reads the now-higher maximum and retries,
    up to `_MAX_APPEND_RETRIES` times, instead of propagating a `500`.
    """
    get_or_create_conversation(db, now=now)
    last_error: IntegrityError | None = None
    for _attempt in range(_MAX_APPEND_RETRIES):
        next_sequence = _next_sequence(db)
        try:
            with db.begin_nested():
                return _insert_message(db, role=role, text=text, now=now, sequence=next_sequence)
        except IntegrityError as exc:
            last_error = exc
            continue
    assert last_error is not None
    raise last_error
