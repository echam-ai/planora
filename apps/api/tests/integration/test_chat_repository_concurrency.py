"""Deterministic concurrency tests for `db.chat_repository` (carried
forward from #39's PM acceptance note; issue #40 acceptance).

Both races are simulated the same way `tests/integration/
test_archive_job_concurrency.py` simulates its own race — injecting a
competing write at the exact call site, immediately before the "real" one
runs, rather than relying on real thread/lock timing (which SQLite's
single-writer semantics make unreliable to assert on directly). Here, the
seam is `chat_repository._insert_conversation`/`_insert_message`, each
monkeypatched to open and commit a *second*, independent session — exactly
mimicking a second concurrent request that won the race to write first —
before delegating to the real insert, which must then observe the
resulting `IntegrityError`, retry, and still succeed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.db import chat_repository
from planora_api.db.models import ChatMessage, ChatRole, Conversation

NOW = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)


def _all_conversations(session_factory: sessionmaker[Session]) -> list[Conversation]:
    with session_factory() as session:
        return list(session.execute(select(Conversation)).scalars().all())


def _all_messages(session_factory: sessionmaker[Session]) -> list[ChatMessage]:
    with session_factory() as session:
        return list(
            session.execute(select(ChatMessage).order_by(ChatMessage.sequence)).scalars().all()
        )


# --- Two concurrent first-time conversation creations -----------------------


def test_two_concurrent_first_time_conversation_creations_both_succeed(
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert _all_conversations(migrated_session_factory) == []
    real_insert = chat_repository._insert_conversation

    def racing_insert(db: Session, *, now: datetime) -> Conversation:
        # Simulate a second, independent request winning the race: it
        # inserts and commits its own row — through the *real* insert, not
        # this patched hook, or the "other" session's own call would race
        # against itself recursively — fully, before this (the "first")
        # request's own insert ever runs.
        with migrated_session_factory() as other_session:
            real_insert(other_session, now=now)
            other_session.commit()
        return real_insert(db, now=now)

    monkeypatch.setattr(chat_repository, "_insert_conversation", racing_insert)

    with migrated_session_factory() as session:
        conversation = chat_repository.get_or_create_conversation(session, now=NOW)
        session.commit()

    assert conversation is not None
    assert len(_all_conversations(migrated_session_factory)) == 1


def test_get_or_create_conversation_returns_the_winners_id_after_retry(
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_insert = chat_repository._insert_conversation
    winner_id: dict[str, uuid.UUID] = {}

    def racing_insert(db: Session, *, now: datetime) -> Conversation:
        with migrated_session_factory() as other_session:
            other = real_insert(other_session, now=now)
            winner_id["id"] = other.conversation_id
            other_session.commit()
        return real_insert(db, now=now)

    monkeypatch.setattr(chat_repository, "_insert_conversation", racing_insert)

    with migrated_session_factory() as session:
        conversation = chat_repository.get_or_create_conversation(session, now=NOW)
        session.commit()
        conversation_id = conversation.conversation_id

    assert conversation_id == winner_id["id"]


# --- Two concurrent message appends racing for the same sequence -----------


def test_two_concurrent_message_appends_both_persist_with_unique_sequences(
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with migrated_session_factory() as session:
        chat_repository.get_or_create_conversation(session, now=NOW)
        session.commit()

    real_insert = chat_repository._insert_message
    call_count = {"n": 0}

    def racing_insert(
        db: Session, *, role: ChatRole, text: str, now: datetime, sequence: int
    ) -> ChatMessage:
        call_count["n"] += 1
        if call_count["n"] == 1:
            # Only the very first attempt races — a second request commits
            # a message at the same `sequence` this call is about to use,
            # simulating it landing first.
            with migrated_session_factory() as other_session:
                chat_repository.append_message(
                    other_session, role=ChatRole.USER, text="from the other request", now=now
                )
                other_session.commit()
        return real_insert(db, role=role, text=text, now=now, sequence=sequence)

    monkeypatch.setattr(chat_repository, "_insert_message", racing_insert)

    with migrated_session_factory() as session:
        message = chat_repository.append_message(
            session, role=ChatRole.ASSISTANT, text="from this request", now=NOW
        )
        session.commit()
        message_text = message.text

    assert message_text == "from this request"
    all_messages = _all_messages(migrated_session_factory)
    assert [m.text for m in all_messages] == ["from the other request", "from this request"]
    sequences = [m.sequence for m in all_messages]
    assert sequences == sorted(sequences)
    assert len(set(sequences)) == len(sequences)


def test_racing_user_then_assistant_append_stay_adjacent_and_in_order(
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mirrors the shape `api.v1.chat.send_message` actually produces: one
    request appends its user turn, then its assistant turn, while a
    competing insert (simulating a second request) lands at the sequence
    the first append was about to use. Both of *this* request's turns must
    still end up adjacent and in user-then-assistant order."""
    with migrated_session_factory() as session:
        chat_repository.get_or_create_conversation(session, now=NOW)
        session.commit()

    real_insert = chat_repository._insert_message
    raced = {"done": False}

    def racing_insert(
        db: Session, *, role: ChatRole, text: str, now: datetime, sequence: int
    ) -> ChatMessage:
        if not raced["done"]:
            raced["done"] = True
            with migrated_session_factory() as other_session:
                chat_repository.append_message(
                    other_session, role=ChatRole.USER, text="interleaved", now=now
                )
                other_session.commit()
        return real_insert(db, role=role, text=text, now=now, sequence=sequence)

    monkeypatch.setattr(chat_repository, "_insert_message", racing_insert)

    with migrated_session_factory() as session:
        chat_repository.append_message(session, role=ChatRole.USER, text="user turn", now=NOW)
        session.commit()
    with migrated_session_factory() as session:
        chat_repository.append_message(
            session, role=ChatRole.ASSISTANT, text="assistant turn", now=NOW
        )
        session.commit()

    texts_in_order = [m.text for m in _all_messages(migrated_session_factory)]
    user_index = texts_in_order.index("user turn")
    assistant_index = texts_in_order.index("assistant turn")
    assert assistant_index == user_index + 1


# --- The single-row constraint still holds after a retry -------------------


def test_conversation_check_constraint_still_enforced_after_a_retry(
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_insert = chat_repository._insert_conversation

    def racing_insert(db: Session, *, now: datetime) -> Conversation:
        with migrated_session_factory() as other_session:
            real_insert(other_session, now=now)
            other_session.commit()
        return real_insert(db, now=now)

    monkeypatch.setattr(chat_repository, "_insert_conversation", racing_insert)

    with migrated_session_factory() as session:
        chat_repository.get_or_create_conversation(session, now=NOW)
        session.commit()

    conversations = _all_conversations(migrated_session_factory)
    assert len(conversations) == 1
    assert conversations[0].id == 1
