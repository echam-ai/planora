"""Lost-race outcomes for `chat_action_repository.confirm`/`reject`
(issue #95). Same seam technique as
`test_chat_action_confirm_concurrency.py`: monkeypatch the module-level
compare-and-set to run and commit a competing operation in its own session,
then delegate to the real compare-and-set, which must lose and report the
true outcome of the committed row."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.db import chat_action_repository, chat_repository
from planora_api.db.models import ChatMessage, Task
from planora_api.errors import ApiError

from .test_chat_action_confirm_concurrency import NOW, _seed_pending_create_action

Competitor = Callable[[Session, uuid.UUID], None]


def _confirm(session: Session, action_id: uuid.UUID) -> None:
    chat_action_repository.confirm(session, action_id, now=NOW)


def _reject(session: Session, action_id: uuid.UUID) -> None:
    chat_action_repository.reject(session, action_id, now=NOW)


def _reset(session: Session, action_id: uuid.UUID) -> None:
    chat_repository.reset_conversation(session, now=NOW)


def _race(
    monkeypatch: pytest.MonkeyPatch,
    factory: sessionmaker[Session],
    seam: str,
    competitor: Competitor,
) -> None:
    real = getattr(chat_action_repository, seam)
    fired = {"n": 0}

    def racing(db: Session, target_id: uuid.UUID, *, now: datetime) -> bool:
        fired["n"] += 1
        if fired["n"] == 1:
            with factory() as other:
                competitor(other, target_id)
                other.commit()
        return real(db, target_id, now=now)

    monkeypatch.setattr(chat_action_repository, seam, racing)


def _state(factory: sessionmaker[Session], action_id: uuid.UUID) -> tuple[str | None, int, int]:
    with factory() as session:
        action = chat_action_repository.get_action(session, action_id)
        tasks = len(session.execute(select(Task)).scalars().all())
        confirmations = [
            m for m in session.execute(select(ChatMessage)).scalars().all() if m.text.startswith("Done")
        ]
        return (action.status.value if action else None, tasks, len(confirmations))


def test_reject_losing_to_confirm_raises_already_applied(
    migrated_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    action_id = _seed_pending_create_action(migrated_session_factory)
    _race(monkeypatch, migrated_session_factory, "try_mark_rejected", _confirm)

    with migrated_session_factory() as session, pytest.raises(ApiError) as exc:
        chat_action_repository.reject(session, action_id, now=NOW)
    assert (exc.value.status_code, exc.value.code) == (409, "ACTION_ALREADY_APPLIED")
    assert exc.value.message == "This change has already been applied."
    assert _state(migrated_session_factory, action_id) == ("applied", 1, 1)


def test_reject_losing_to_reject_is_a_noop(
    migrated_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    action_id = _seed_pending_create_action(migrated_session_factory)
    _race(monkeypatch, migrated_session_factory, "try_mark_rejected", _reject)

    with migrated_session_factory() as session:
        chat_action_repository.reject(session, action_id, now=NOW)
        session.commit()
    assert _state(migrated_session_factory, action_id) == ("rejected", 0, 0)


def test_reject_losing_to_reset_raises_not_found(
    migrated_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    action_id = _seed_pending_create_action(migrated_session_factory)
    _race(monkeypatch, migrated_session_factory, "try_mark_rejected", _reset)

    with migrated_session_factory() as session, pytest.raises(ApiError) as exc:
        chat_action_repository.reject(session, action_id, now=NOW)
    assert (exc.value.status_code, exc.value.code) == (404, "NOT_FOUND")
    assert exc.value.message == "That proposed change is no longer available."


def test_confirm_losing_to_reject_raises_already_rejected(
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    action_id = _seed_pending_create_action(migrated_session_factory)
    _race(monkeypatch, migrated_session_factory, "try_mark_applied", _reject)

    with (
        caplog.at_level(logging.INFO, logger="planora_api.db.chat_action_repository"),
        migrated_session_factory() as session,
        pytest.raises(ApiError) as exc,
    ):
        chat_action_repository.confirm(session, action_id, now=NOW)
    assert (exc.value.status_code, exc.value.code) == (409, "ACTION_ALREADY_REJECTED")
    assert exc.value.message == "This change was cancelled, so it wasn't applied."
    assert _state(migrated_session_factory, action_id) == ("rejected", 0, 0)
    outcomes = [getattr(r, "outcome", None) for r in caplog.records if r.getMessage() == "chat_action_confirm"]
    assert "already_rejected" in outcomes
    assert "stale" not in outcomes


def test_confirm_losing_to_reset_raises_not_found(
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    action_id = _seed_pending_create_action(migrated_session_factory)
    _race(monkeypatch, migrated_session_factory, "try_mark_applied", _reset)

    with (
        caplog.at_level(logging.INFO, logger="planora_api.db.chat_action_repository"),
        migrated_session_factory() as session,
        pytest.raises(ApiError) as exc,
    ):
        chat_action_repository.confirm(session, action_id, now=NOW)
    assert (exc.value.status_code, exc.value.code) == (404, "NOT_FOUND")
    assert _state(migrated_session_factory, action_id)[1] == 0
    outcomes = [getattr(r, "outcome", None) for r in caplog.records if r.getMessage() == "chat_action_confirm"]
    assert "not_found" in outcomes
    assert "stale" not in outcomes
