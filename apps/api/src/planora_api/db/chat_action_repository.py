"""Repository and confirm/reject orchestration for `chat_action` rows
(issue #41, spec §10.1-§10.4).

Mirrors `db/chat_repository.py`'s shape: plain CRUD (`create_action`,
`get_action`) plus the write path. `confirm`/`reject` are the one place
outside `api.v1.chat` that implements the confirm/reject business rules —
kept here, not in the router, so a concurrency test can call `confirm`
directly against a second, independent session (the same technique
`tests/integration/test_chat_repository_concurrency.py` and
`tests/integration/test_archive_job_concurrency.py` already use) without
going through the ASGI app. Both raise `planora_api.errors.ApiError`
directly for every documented failure — that type carries no FastAPI
dependency, so raising it from a plain function like this is exactly what
`api.v1.chat`'s route handlers rely on to turn it into the standard error
envelope.

Every function takes an already-open `Session` and never commits, matching
every other repository in this package.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Sequence
from datetime import datetime
from functools import partial
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from planora_api.db import chat_repository, task_repository
from planora_api.db.models import (
    ChatAction,
    ChatActionKind,
    ChatActionStatus,
    ChatRole,
    Task,
    TaskStatus,
)
from planora_api.db.profile import profile_id
from planora_api.domain import chat_actions
from planora_api.domain.chat_actions import ActionField
from planora_api.errors import ApiError
from planora_api.schemas.task import TaskCreate, TaskMove, TaskUpdate

logger = logging.getLogger("planora_api.db.chat_action_repository")

# spec §41: the fixed confirmation message text, appended in the same
# transaction as the task write and the action's `applied` status.
_CONFIRMATION_TEXT = "Done — I applied that change to your board."

_STALE_MESSAGE = (
    "This task changed after the proposal, so nothing was applied. "
    "Ask for an up-to-date preview."
)
_ALREADY_REJECTED_MESSAGE = "This change was cancelled, so it wasn't applied."
_ALREADY_APPLIED_MESSAGE = "This change has already been applied."
_NOT_FOUND_MESSAGE = "That proposed change is no longer available."


def _serialize_fields(fields: list[ActionField]) -> list[dict[str, Any]]:
    return [{"label": f.label, "from": f.from_value, "to": f.to_value} for f in fields]


def create_action(
    db: Session,
    *,
    message_id: uuid.UUID,
    kind: ChatActionKind,
    title: str,
    summary: str,
    fields: list[ActionField],
    payload: dict[str, Any],
    task_id: uuid.UUID | None,
    stale_snapshot: dict[str, Any],
    changed_fields: dict[str, Any] | None,
    now: datetime,
) -> ChatAction:
    """Persist one proposal, already fully computed by `ai.propose_tools`.
    Never called until `ai.chat.send_chat_message`'s whole tool-call loop
    has succeeded — see that module and `api.v1.chat.send_message`."""
    started = time.perf_counter()
    action = ChatAction(
        id=uuid.uuid4(),
        profile_id=profile_id(db),
        message_id=message_id,
        kind=kind,
        status=ChatActionStatus.PENDING,
        title=title,
        summary=summary,
        fields=_serialize_fields(fields),
        payload=payload,
        task_id=task_id,
        stale_snapshot=stale_snapshot,
        changed_fields=changed_fields,
        created_at=now,
        updated_at=now,
    )
    db.add(action)
    db.flush()
    _log_action("proposal", kind=kind.value, action_id=action.id, outcome="pending", started=started)
    return action


def get_action(db: Session, action_id: uuid.UUID) -> ChatAction | None:
    return db.execute(select(ChatAction).where(ChatAction.id == action_id, ChatAction.profile_id == profile_id(db))).scalar_one_or_none()


def list_actions_by_message_id(db: Session) -> dict[uuid.UUID, ChatAction]:
    """Every `chat_action` row, keyed by `message_id` — `api.v1.chat`
    attaches at most one to each message when building `ConversationResponse`
    (spec §41: "Every `ChatMessageResponse` has an `action` key")."""
    actions = db.execute(select(ChatAction).where(ChatAction.profile_id == profile_id(db))).scalars().all()
    return {action.message_id: action for action in actions}


def list_actions_for_messages(
    db: Session, message_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, ChatAction]:
    """The `chat_action` rows attached to just these messages, keyed by
    `message_id` — the LLM history window's actions (issue #121)."""
    if not message_ids:
        return {}
    stmt = select(ChatAction).where(
        ChatAction.profile_id == profile_id(db), ChatAction.message_id.in_(message_ids)
    )
    return {action.message_id: action for action in db.execute(stmt).scalars().all()}


def _try_transition(
    db: Session, action_id: uuid.UUID, new_status: ChatActionStatus, now: datetime
) -> bool:
    """Compare-and-set: `pending` -> `new_status`. Returns whether *this*
    call performed the transition, so a loser of a race can never overwrite
    the winner's committed status."""
    result = db.execute(
        update(ChatAction)
        .where(ChatAction.id == action_id, ChatAction.profile_id == profile_id(db), ChatAction.status == ChatActionStatus.PENDING)
        .values(status=new_status, updated_at=now)
        .execution_options(synchronize_session=False)
    )
    db.flush()
    return result.rowcount == 1


def try_mark_applied(db: Session, action_id: uuid.UUID, *, now: datetime) -> bool:
    """Compare-and-set `pending` -> `applied`. A module-level function (not
    a closure), the same pattern `jobs.archive_done_tasks._archive_one` and
    `db.chat_repository._insert_message` use, so a test can monkeypatch it
    directly to inject a competing confirm deterministically, immediately
    before the real compare-and-set runs (see
    `tests/integration/test_chat_action_confirm_concurrency.py`)."""
    return _try_transition(db, action_id, ChatActionStatus.APPLIED, now)


def try_mark_rejected(db: Session, action_id: uuid.UUID, *, now: datetime) -> bool:
    """Compare-and-set `pending` -> `rejected`, monkeypatchable like
    `try_mark_applied`: a reject that read `pending` can never overwrite a
    confirm that committed `applied` first."""
    return _try_transition(db, action_id, ChatActionStatus.REJECTED, now)


def _reread_committed(db: Session, action_id: uuid.UUID) -> ChatAction | None:
    """Re-read a row after a lost compare-and-set, bypassing the session's
    identity-map copy so the winner's committed status is what we see."""
    return db.execute(select(ChatAction).where(ChatAction.id == action_id, ChatAction.profile_id == profile_id(db)).execution_options(populate_existing=True)).scalar_one_or_none()


def _task_field_snapshot(task: Task) -> dict[str, Any]:
    """The live task's raw (unformatted) field values, in the same shape
    `ai.propose_tools` stores in `ChatAction.stale_snapshot` — the input
    `domain.chat_actions.is_stale` compares against."""
    return {
        "title": task.title,
        "content": task.content,
        "category": task.category.value,
        "priority": task.priority.value,
        "status": task.status.value,
        "deadline_at": task.deadline_at.isoformat() if task.deadline_at else None,
    }


def _apply_action_write(db: Session, action: ChatAction, *, task: Task | None, now: datetime) -> None:
    """Perform the confirmed write through the exact same code `POST
    /tasks`, `PATCH /tasks/{id}` and the move endpoint use
    (`db.task_repository`) — never a second copy of that logic here."""
    if action.kind == ChatActionKind.CREATE:
        body = TaskCreate.model_validate(action.payload["draft"])
        task_repository.create_task_from_request(db, body, now)
        return

    assert task is not None
    if action.kind == ChatActionKind.UPDATE:
        body = TaskUpdate.model_validate(action.changed_fields or {})
        task_repository.apply_task_update(db, task, body, now)
    elif action.kind == ChatActionKind.MOVE:
        new_status = TaskStatus(action.payload["status"])
        target_count = len(
            task_repository.list_active_tasks_by_status(db, new_status, exclude_id=task.id)
        )
        body = TaskMove(status=new_status, index=target_count)
        task_repository.apply_task_move(db, task, body, now)
    elif action.kind == ChatActionKind.SCHEDULE:
        body = TaskUpdate(deadline_at=action.payload["deadline_at"])
        task_repository.apply_task_update(db, task, body, now)
    else:  # pragma: no cover - exhaustive over ChatActionKind
        raise AssertionError(f"unhandled ChatActionKind: {action.kind!r}")


def _log_action(
    operation: str, *, kind: str | None, action_id: uuid.UUID, outcome: str, started: float
) -> None:
    """spec §41: "Proposal, confirm and reject logs contain only the
    action kind, action id, outcome and duration" — never a title,
    content, deadline, URL, field value or raw tool argument."""
    logger.info(
        f"chat_action_{operation}",
        extra={
            "kind": kind,
            "action_id": str(action_id),
            "outcome": outcome,
            "duration_ms": round((time.perf_counter() - started) * 1000, 3),
        },
    )


def confirm(db: Session, action_id: uuid.UUID, *, now: datetime) -> None:
    """Apply a `pending` proposal's write, or no-op safely for any other
    legal state (spec §41). Raises `ApiError` for every documented failure:
    `404` for an unknown/reset-removed id, `409 ACTION_ALREADY_REJECTED`,
    `409 ACTION_STALE` for a target task that no longer matches the
    proposal's preview (or was deleted/archived).

    One transaction does everything: the compare-and-set to `applied`, the
    task write, and the confirmation message — all through this same
    session, so a failure anywhere leaves the action `pending` and nothing
    else written (the request-scoped `get_db` dependency rolls the whole
    transaction back).
    """
    log = partial(
        _log_action, "confirm", action_id=action_id, started=time.perf_counter()
    )
    action = get_action(db, action_id)
    if action is None:
        log(kind=None, outcome="not_found")
        raise ApiError(404, "NOT_FOUND", _NOT_FOUND_MESSAGE)

    log = partial(log, kind=action.kind.value)
    outcome = chat_actions.confirm_outcome(action.status.value)
    if outcome == "already_rejected":
        log(outcome="already_rejected")
        raise ApiError(409, "ACTION_ALREADY_REJECTED", _ALREADY_REJECTED_MESSAGE)
    if outcome == "noop":
        log(outcome="noop")
        return

    task: Task | None = None
    if action.kind != ChatActionKind.CREATE:
        assert action.task_id is not None
        task = task_repository.get_active_task(db, action.task_id)
        if task is None or chat_actions.is_stale(
            current=_task_field_snapshot(task), snapshot=action.stale_snapshot
        ):
            log(outcome="stale")
            raise ApiError(409, "ACTION_STALE", _STALE_MESSAGE)

    if not try_mark_applied(db, action_id, now=now):
        # Lost a race: re-read the committed row and report what actually
        # happened, chosen by the same domain rule as the pre-check.
        refreshed = _reread_committed(db, action_id)
        if refreshed is None:
            log(outcome="not_found")
            raise ApiError(404, "NOT_FOUND", _NOT_FOUND_MESSAGE)
        if chat_actions.confirm_outcome(refreshed.status.value) == "already_rejected":
            log(outcome="already_rejected")
            raise ApiError(409, "ACTION_ALREADY_REJECTED", _ALREADY_REJECTED_MESSAGE)
        # A competing confirm won: this call's own idempotent success,
        # never a second write.
        log(outcome="applied_by_race")
        return

    _apply_action_write(db, action, task=task, now=now)
    chat_repository.append_message(db, role=ChatRole.ASSISTANT, text=_CONFIRMATION_TEXT, now=now)
    log(outcome="applied")


def reject(db: Session, action_id: uuid.UUID, *, now: datetime) -> None:
    """Reject a `pending` proposal, or no-op safely if already rejected.
    The transition is a compare-and-set (`try_mark_rejected`); losing it
    re-reads the committed row. Raises `ApiError(404, ...)` for an unknown
    (or reset-removed) id and
    `ApiError(409, "ACTION_ALREADY_APPLIED", ...)` for an already-applied
    one. Writes nothing else — no task row, no message."""
    log = partial(
        _log_action, "reject", action_id=action_id, started=time.perf_counter()
    )
    action = get_action(db, action_id)
    if action is None:
        log(kind=None, outcome="not_found")
        raise ApiError(404, "NOT_FOUND", _NOT_FOUND_MESSAGE)

    log = partial(log, kind=action.kind.value)
    outcome = chat_actions.reject_outcome(action.status.value)
    if outcome == "already_applied":
        log(outcome="already_applied")
        raise ApiError(409, "ACTION_ALREADY_APPLIED", _ALREADY_APPLIED_MESSAGE)
    if outcome == "noop":
        log(outcome="noop")
        return

    if try_mark_rejected(db, action_id, now=now):
        log(outcome="rejected")
        return

    # Lost a race: re-read the committed row and report the true outcome.
    refreshed = _reread_committed(db, action_id)
    if refreshed is None:
        log(outcome="not_found")
        raise ApiError(404, "NOT_FOUND", _NOT_FOUND_MESSAGE)
    if chat_actions.reject_outcome(refreshed.status.value) == "already_applied":
        log(outcome="already_applied")
        raise ApiError(409, "ACTION_ALREADY_APPLIED", _ALREADY_APPLIED_MESSAGE)
    log(outcome="noop")
