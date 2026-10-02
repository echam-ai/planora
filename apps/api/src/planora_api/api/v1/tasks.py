"""`/api/v1/tasks` — list, create, read, update, delete, move and reorder
(issues #28, #29).

Thin by design: this module validates the request and delegates every
query and write to `db.task_repository` — `create_task_from_request`,
`apply_task_update` and `apply_task_move` own the `domain.ordering`/
`domain.completion` logic (shared with issue #41's chat-confirmed writes;
see that module's docstring). `POST /reorder` is registered as a literal
path before the `/{task_id}` family so it can never be shadowed by a path
parameter. Archive list, search, restore and permanent delete stay with
#30.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response

from planora_api.api.deps import DbSession, get_current_time, require_session
from planora_api.db import task_repository
from planora_api.db.models import AuthSession, Task
from planora_api.errors import (
    AUTH_RESPONSES,
    ERROR_RESPONSE,
    VALIDATION_RESPONSE,
    WRITE_RESPONSES,
    ApiError,
    not_found,
)
from planora_api.schemas.task import (
    TaskCreate,
    TaskMove,
    TaskReorder,
    TaskResponse,
    TaskUpdate,
)

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])

_NOT_FOUND_MESSAGE = "Task not found."

_VALIDATED_RESPONSES = {**AUTH_RESPONSES, 422: VALIDATION_RESPONSE}
_ITEM_RESPONSES = {**_VALIDATED_RESPONSES, 404: ERROR_RESPONSE}
_CREATE_RESPONSES = {**WRITE_RESPONSES, 422: VALIDATION_RESPONSE}
_MUTATE_ITEM_RESPONSES = {**WRITE_RESPONSES, 404: ERROR_RESPONSE, 422: VALIDATION_RESPONSE}
_REORDER_RESPONSES = {**WRITE_RESPONSES, 422: VALIDATION_RESPONSE}


def _ordering_error(exc: ValueError) -> ApiError:
    """A `domain/ordering.py` `ValueError` — a bad index or a stale/invalid
    `ordered_ids` — is always the client's fault, never the server's: `422`
    with the standard envelope, never a `500`."""
    return ApiError(422, "VALIDATION_ERROR", str(exc))


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
    return task_repository.create_task_from_request(db, body, now)


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
    try:
        task_repository.apply_task_reorder(db, body)
    except ValueError as exc:
        raise _ordering_error(exc) from exc
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
        raise not_found(_NOT_FOUND_MESSAGE)
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
        raise not_found(_NOT_FOUND_MESSAGE)
    return task_repository.apply_task_update(db, task, body, now)


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
        raise not_found(_NOT_FOUND_MESSAGE)
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
        raise not_found(_NOT_FOUND_MESSAGE)

    try:
        task_repository.apply_task_move(db, task, body, now)
    except ValueError as exc:
        raise _ordering_error(exc) from exc
    return task_repository.list_active_tasks(db)
