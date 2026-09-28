"""`/api/v1/tasks` — list, create, read, update, delete, move and reorder
(issues #28, #29).

Thin by design: this module validates the request via `schemas.task`,
computes `position` and `completed_at` through the pure `domain` functions,
and delegates every query to `db.task_repository`. `POST /reorder` is
registered as a literal path before the `/{task_id}` family so it can never
be shadowed by a path parameter. Archive list, search, restore and
permanent delete stay with #30.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response

from planora_api.api.deps import DbSession, get_current_time, require_session
from planora_api.db import task_repository
from planora_api.db.models import AuthSession, Task, TaskStatus
from planora_api.domain import ordering
from planora_api.domain.completion import resolve_completed_at
from planora_api.errors import ERROR_RESPONSE, VALIDATION_RESPONSE, ApiError
from planora_api.schemas.task import (
    TaskCreate,
    TaskMove,
    TaskReorder,
    TaskResponse,
    TaskUpdate,
)

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])

_NOT_FOUND_MESSAGE = "Task not found."

_AUTH_RESPONSES = {401: ERROR_RESPONSE}
_WRITE_RESPONSES = {**_AUTH_RESPONSES, 403: ERROR_RESPONSE}
_VALIDATED_RESPONSES = {**_AUTH_RESPONSES, 422: VALIDATION_RESPONSE}
_ITEM_RESPONSES = {**_VALIDATED_RESPONSES, 404: ERROR_RESPONSE}
_CREATE_RESPONSES = {**_WRITE_RESPONSES, 422: VALIDATION_RESPONSE}
_MUTATE_ITEM_RESPONSES = {**_WRITE_RESPONSES, 404: ERROR_RESPONSE, 422: VALIDATION_RESPONSE}
_REORDER_RESPONSES = {**_WRITE_RESPONSES, 422: VALIDATION_RESPONSE}


def _not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", _NOT_FOUND_MESSAGE)


def _ordering_error(exc: ValueError) -> ApiError:
    """A `domain/ordering.py` `ValueError` — a bad index or a stale/invalid
    `ordered_ids` — is always the client's fault, never the server's: `422`
    with the standard envelope, never a `500`."""
    return ApiError(422, "VALIDATION_ERROR", str(exc))


def _apply_column_changes(
    changes: dict[uuid.UUID, float], others_by_id: dict[uuid.UUID, Task]
) -> None:
    """Write every position `ordering` returned back onto the loaded ORM
    rows in `others_by_id` — the moved task itself is set by the caller."""
    for task_id, position in changes.items():
        other = others_by_id.get(task_id)
        if other is not None:
            other.position = position


@router.get("", response_model=list[TaskResponse], responses=_VALIDATED_RESPONSES)
def list_tasks(
    db: DbSession, _session: Annotated[AuthSession, Depends(require_session)]
) -> list[Task]:
    return task_repository.list_active_tasks(db)


@router.post(
    "", response_model=TaskResponse, status_code=201, responses=_CREATE_RESPONSES
)
def create_task(
    body: TaskCreate,
    db: DbSession,
    now: Annotated[datetime, Depends(get_current_time)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> Task:
    task_id = uuid.uuid4()

    column_tasks = task_repository.list_active_tasks_by_status(db, body.status)
    target = [(task.id, task.position) for task in column_tasks]
    changes = ordering.move_to_column(
        [(task_id, 0.0)], target, task_id, len(target)
    )

    task = Task(
        id=task_id,
        title=body.title,
        content=body.content,
        status=body.status,
        category=body.category,
        priority=body.priority,
        deadline_at=body.deadline_at,
        urls=[url.model_dump() for url in body.urls],
        markdown_note=body.markdown_note,
        position=changes[task_id],
        created_at=now,
        updated_at=now,
        completed_at=resolve_completed_at(
            new_status=body.status,
            previous_status=None,
            previous_completed_at=None,
            now=now,
        ),
        archived_at=None,
    )
    _apply_column_changes(changes, {t.id: t for t in column_tasks})

    return task_repository.create_task(db, task)


# `POST /reorder` is registered here — a literal path, before the
# `/{task_id}` family below — so a change to those routes can never shadow
# it; see the module docstring's note on issue #29's move/reorder pair.
@router.post(
    "/reorder", response_model=list[TaskResponse], responses=_REORDER_RESPONSES
)
def reorder_tasks(
    body: TaskReorder,
    db: DbSession,
    _session: Annotated[AuthSession, Depends(require_session)],
) -> list[Task]:
    column_tasks = task_repository.list_active_tasks_by_status(db, body.status)
    column = [(t.id, t.position) for t in column_tasks]
    try:
        changes = ordering.reorder_column(column, body.ordered_ids)
    except ValueError as exc:
        raise _ordering_error(exc) from exc

    _apply_column_changes(changes, {t.id: t for t in column_tasks})
    db.flush()
    return task_repository.list_active_tasks(db)


@router.get(
    "/{task_id}", response_model=TaskResponse, responses=_ITEM_RESPONSES
)
def get_task(
    task_id: uuid.UUID,
    db: DbSession,
    _session: Annotated[AuthSession, Depends(require_session)],
) -> Task:
    task = task_repository.get_active_task(db, task_id)
    if task is None:
        raise _not_found()
    return task


@router.patch(
    "/{task_id}", response_model=TaskResponse, responses=_MUTATE_ITEM_RESPONSES
)
def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    db: DbSession,
    now: Annotated[datetime, Depends(get_current_time)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> Task:
    task = task_repository.get_active_task(db, task_id)
    if task is None:
        raise _not_found()

    provided = body.model_dump(exclude_unset=True)

    if "title" in provided:
        task.title = body.title
    if "content" in provided:
        task.content = body.content
    if "category" in provided:
        task.category = body.category
    if "priority" in provided:
        task.priority = body.priority
    if "markdown_note" in provided:
        task.markdown_note = body.markdown_note
    if "urls" in provided:
        task.urls = [url.model_dump() for url in body.urls]
    if "deadline_at" in provided:
        task.deadline_at = body.deadline_at

    if "status" in provided:
        previous_status: TaskStatus = task.status
        new_status = body.status
        assert new_status is not None  # rejected as null by the schema

        if new_status != previous_status:
            source = [
                (t.id, t.position)
                for t in task_repository.list_active_tasks_by_status(
                    db, previous_status
                )
            ]
            target_tasks = task_repository.list_active_tasks_by_status(
                db, new_status, exclude_id=task.id
            )
            target = [(t.id, t.position) for t in target_tasks]
            changes = ordering.move_to_column(
                source, target, task.id, len(target)
            )
            by_id = {t.id: t for t in target_tasks}
            task.position = changes[task.id]
            _apply_column_changes(
                {k: v for k, v in changes.items() if k != task.id}, by_id
            )

        task.completed_at = resolve_completed_at(
            new_status=new_status,
            previous_status=previous_status,
            previous_completed_at=task.completed_at,
            now=now,
        )
        task.status = new_status

    task.updated_at = now
    db.flush()
    return task


@router.delete(
    "/{task_id}", status_code=204, responses=_MUTATE_ITEM_RESPONSES
)
def delete_task(
    task_id: uuid.UUID,
    db: DbSession,
    _session: Annotated[AuthSession, Depends(require_session)],
) -> Response:
    task = task_repository.get_active_task(db, task_id)
    if task is None:
        raise _not_found()
    task_repository.delete_task(db, task)
    return Response(status_code=204)


@router.post(
    "/{task_id}/move",
    response_model=list[TaskResponse],
    responses=_MUTATE_ITEM_RESPONSES,
)
def move_task(
    task_id: uuid.UUID,
    body: TaskMove,
    db: DbSession,
    now: Annotated[datetime, Depends(get_current_time)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> list[Task]:
    """Board drag (or an AI-confirmed move), cross-column or within one
    column (issue #29). `completed_at` always goes through
    `resolve_completed_at` — entering, leaving and staying in Done are all
    handled by that one rule, never re-implemented here."""
    task = task_repository.get_active_task(db, task_id)
    if task is None:
        raise _not_found()

    previous_status = task.status
    new_status = body.status

    if new_status == previous_status:
        column_tasks = task_repository.list_active_tasks_by_status(
            db, previous_status
        )
        column = [(t.id, t.position) for t in column_tasks]
        try:
            changes = ordering.reorder_within_column(column, task.id, body.index)
        except ValueError as exc:
            raise _ordering_error(exc) from exc
        _apply_column_changes(changes, {t.id: t for t in column_tasks})
    else:
        source_tasks = task_repository.list_active_tasks_by_status(
            db, previous_status
        )
        source = [(t.id, t.position) for t in source_tasks]
        target_tasks = task_repository.list_active_tasks_by_status(
            db, new_status, exclude_id=task.id
        )
        target = [(t.id, t.position) for t in target_tasks]
        try:
            changes = ordering.move_to_column(source, target, task.id, body.index)
        except ValueError as exc:
            raise _ordering_error(exc) from exc
        by_id = {t.id: t for t in target_tasks}
        task.position = changes[task.id]
        _apply_column_changes(
            {k: v for k, v in changes.items() if k != task.id}, by_id
        )
        task.status = new_status

    task.completed_at = resolve_completed_at(
        new_status=new_status,
        previous_status=previous_status,
        previous_completed_at=task.completed_at,
        now=now,
    )
    task.updated_at = now
    db.flush()
    return task_repository.list_active_tasks(db)
