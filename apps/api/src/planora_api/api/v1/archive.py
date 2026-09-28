"""`/api/v1/archive` — list, search, read, restore and permanently delete
archived tasks (issue #30, spec §9.2).

Thin by design, matching `api.v1.tasks`: this module validates the request,
delegates every query to `db.task_repository`, and computes the restored
task's position through the same pure `domain.ordering.move_to_column`
`api.v1.tasks.create_task` already uses to append a new task to the end of
a column — restoring is, position-wise, exactly that: inserting one task at
the end of the active Todo column. `status`, `completed_at` and
`archived_at` are set directly here since there is no cross-column move to
reconcile (the archived task isn't a member of any active column).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from planora_api.api.deps import DbSession, get_current_time, require_session
from planora_api.db import task_repository
from planora_api.db.models import AuthSession, Task, TaskStatus
from planora_api.domain import ordering
from planora_api.errors import ERROR_RESPONSE, VALIDATION_RESPONSE, ApiError
from planora_api.schemas.archive import ArchiveListResponse
from planora_api.schemas.task import TaskResponse

router = APIRouter(prefix="/api/v1/archive", tags=["archive"])

_NOT_FOUND_MESSAGE = "Archived task not found."

# The mock `ApiClient.listArchive` (`apps/web/src/services/api/mock/
# archive.ts`) defaults to a page of 10 — kept identical here so #35's swap
# changes no page component's expectations. 100 is this endpoint's
# documented maximum `page_size`; a caller asking for more gets a `422`,
# never a silently clamped page.
_DEFAULT_PAGE_SIZE = 10
_MAX_PAGE_SIZE = 100

_AUTH_RESPONSES = {401: ERROR_RESPONSE}
_WRITE_RESPONSES = {**_AUTH_RESPONSES, 403: ERROR_RESPONSE}
_VALIDATED_RESPONSES = {**_AUTH_RESPONSES, 422: VALIDATION_RESPONSE}
_ITEM_RESPONSES = {**_VALIDATED_RESPONSES, 404: ERROR_RESPONSE}
_MUTATE_ITEM_RESPONSES = {**_WRITE_RESPONSES, 404: ERROR_RESPONSE, 422: VALIDATION_RESPONSE}


def _not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", _NOT_FOUND_MESSAGE)


@router.get("", response_model=ArchiveListResponse, responses=_VALIDATED_RESPONSES)
def list_archive(
    db: DbSession,
    _session: Annotated[AuthSession, Depends(require_session)],
    search: str | None = Query(
        default=None,
        description="Case-insensitive substring match on title only. "
        "Leading/trailing whitespace is trimmed; blank behaves as no search.",
    ),
    page: int = Query(default=1, ge=1, description="1-based page number."),
    page_size: int = Query(
        default=_DEFAULT_PAGE_SIZE,
        ge=1,
        le=_MAX_PAGE_SIZE,
        description=f"Items per page, up to {_MAX_PAGE_SIZE}.",
    ),
) -> ArchiveListResponse:
    items, total = task_repository.list_archived_tasks(
        db, search=search, page=page, page_size=page_size
    )
    return ArchiveListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/{task_id}", response_model=TaskResponse, responses=_ITEM_RESPONSES)
def get_archived_task(
    task_id: uuid.UUID,
    db: DbSession,
    _session: Annotated[AuthSession, Depends(require_session)],
) -> Task:
    task = task_repository.get_archived_task(db, task_id)
    if task is None:
        raise _not_found()
    return task


@router.post(
    "/{task_id}/restore",
    response_model=TaskResponse,
    responses=_MUTATE_ITEM_RESPONSES,
)
def restore_task(
    task_id: uuid.UUID,
    db: DbSession,
    now: Annotated[datetime, Depends(get_current_time)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> Task:
    task = task_repository.get_archived_task(db, task_id)
    if task is None:
        raise _not_found()

    todo_tasks = task_repository.list_active_tasks_by_status(db, TaskStatus.TODO)
    target = [(t.id, t.position) for t in todo_tasks]
    # A single-entry "source" holding just the restored task, exactly like
    # `create_task`'s use of the same function to append a brand-new task —
    # there is no real source column here since an archived task belongs to
    # none.
    changes = ordering.move_to_column([(task_id, 0.0)], target, task_id, len(target))

    by_id = {t.id: t for t in todo_tasks}
    for other_id, position in changes.items():
        if other_id == task_id:
            continue
        other = by_id.get(other_id)
        if other is not None:
            other.position = position

    task.status = TaskStatus.TODO
    task.position = changes[task_id]
    task.completed_at = None
    task.archived_at = None
    task.updated_at = now
    db.flush()
    return task


@router.delete("/{task_id}", status_code=204, responses=_MUTATE_ITEM_RESPONSES)
def delete_archived_task(
    task_id: uuid.UUID,
    db: DbSession,
    _session: Annotated[AuthSession, Depends(require_session)],
) -> Response:
    task = task_repository.get_archived_task(db, task_id)
    if task is None:
        raise _not_found()
    task_repository.delete_task(db, task)
    return Response(status_code=204)
