"""Deterministic concurrency test for `db.chat_action_repository.confirm`
(issue #41 acceptance: "Two concurrent confirms").

Simulated the same way `tests/integration/test_archive_job_concurrency.py`
and `tests/integration/test_chat_repository_concurrency.py` simulate their
own races — injecting a competing write at the exact call site, immediately
before the "real" one runs, rather than relying on real thread/lock timing.
Here the seam is `chat_action_repository.try_mark_applied` (the
compare-and-set from `pending` to `applied`), monkeypatched to run a
*second*, independent, and fully successful `confirm()` call — through its
own session, committed — immediately before delegating to the real
compare-and-set, which must then observe the row already `applied`, lose
the race, and return without writing a second task or a second
confirmation message.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.db import chat_action_repository, chat_repository
from planora_api.db.models import ChatActionKind, ChatMessage, ChatRole, Task
from planora_api.domain.chat_actions import ActionField

NOW = datetime(2026, 9, 29, 12, 0, 0, tzinfo=UTC)


def _seed_pending_create_action(session_factory: sessionmaker[Session]) -> uuid.UUID:
    with session_factory() as session:
        message = chat_repository.append_message(
            session, role=ChatRole.ASSISTANT, text="Preview.", now=NOW
        )
        action = chat_action_repository.create_action(
            session,
            message_id=message.id,
            kind=ChatActionKind.CREATE,
            title="Create task",
            summary="Raced task",
            fields=[ActionField("Title", None, "Raced task")],
            payload={
                "draft": {
                    "title": "Raced task",
                    "content": "Content",
                    "category": "work",
                    "priority": "medium",
                    "deadline_at": None,
                    "urls": [],
                    "markdown_note": "",
                }
            },
            task_id=None,
            stale_snapshot={},
            changed_fields=None,
            now=NOW,
        )
        session.commit()
        return action.id


def test_two_concurrent_confirms_of_the_same_create_action_produce_one_task(
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    action_id = _seed_pending_create_action(migrated_session_factory)
    real_try_mark_applied = chat_action_repository.try_mark_applied
    call_count = {"n": 0}

    def racing_try_mark_applied(db: Session, target_id: uuid.UUID, *, now: datetime) -> bool:
        call_count["n"] += 1
        if call_count["n"] == 1:
            # Simulate a second, independent request winning the race: it
            # runs the *entire* confirm flow (staleness check, CAS, task
            # write, confirmation message) to completion on its own
            # session and commits, before this (the "first") request's own
            # compare-and-set ever runs.
            with migrated_session_factory() as other_session:
                chat_action_repository.confirm(other_session, target_id, now=now)
                other_session.commit()
        return real_try_mark_applied(db, target_id, now=now)

    monkeypatch.setattr(chat_action_repository, "try_mark_applied", racing_try_mark_applied)

    with migrated_session_factory() as session:
        # This call is the "first" request, racing the injected one above.
        chat_action_repository.confirm(session, action_id, now=NOW)
        session.commit()

    with migrated_session_factory() as session:
        tasks = list(session.execute(select(Task)).scalars().all())
        messages = list(session.execute(select(ChatMessage)).scalars().all())
        action = chat_action_repository.get_action(session, action_id)

    assert len(tasks) == 1
    assert tasks[0].title == "Raced task"

    confirmation_messages = [m for m in messages if m.text.startswith("Done")]
    assert len(confirmation_messages) == 1

    assert action is not None
    assert action.status.value == "applied"
