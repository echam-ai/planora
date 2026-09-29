"""Repository functions for the `task` table (spec §5, issue #28).

Every function takes an already-open `Session` (`api.deps.DbSession`) and
never commits — the request-scoped `get_db` dependency commits exactly once,
after the route returns, so a partially-applied create/update/reorder is
never persisted (spec §15.1). Callers pass the resulting ORM objects
straight to `domain/ordering.py`'s `(task_id, position)` column shape and
write any resulting position change back onto these same instances.

`create_task_from_request`, `apply_task_update` and `apply_task_move`
(issue #41) are the one shared write path `api.v1.tasks` and
`db.chat_action_repository.confirm` both call — the acceptance criterion
that a chat-confirmed write "applies the change through the same write
code" (never a second copy of it) is satisfied by both callers reaching the
same functions here, not by convention alone. They accept `schemas.task`
request bodies directly and apply `domain.ordering`/`domain.completion`
exactly as the pre-#41 router bodies did.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from planora_api.db.models import Task, TaskStatus
from planora_api.domain import ordering
from planora_api.domain.completion import resolve_completed_at
from planora_api.schemas.task import TaskCreate, TaskMove, TaskUpdate

# Board column order (spec §7.1): Todo, In Progress, Done. Used only to
# order `list_active_tasks`'s single flat list; a query scoped to one status
# (`list_active_tasks_by_status`) needs no such ordering.
_STATUS_ORDER = case(
    (Task.status == TaskStatus.TODO, 0),
    (Task.status == TaskStatus.IN_PROGRESS, 1),
    (Task.status == TaskStatus.DONE, 2),
)


def list_active_tasks(db: Session) -> list[Task]:
    """Every non-archived task (spec §9.1), ordered by status column then
    ascending position — the deterministic order `GET /tasks` returns."""
    stmt = (
        select(Task)
        .where(Task.archived_at.is_(None))
        .order_by(_STATUS_ORDER, Task.position)
    )
    return list(db.execute(stmt).scalars().all())


def list_active_tasks_by_status(
    db: Session, status: TaskStatus, *, exclude_id: uuid.UUID | None = None
) -> list[Task]:
    """The active tasks in one status column, in display order — the
    `domain/ordering.py` "column" shape for a move into or within it.

    `exclude_id` leaves out a task that is itself moving into this column,
    since its current row isn't part of the column being inserted into.
    """
    stmt = select(Task).where(Task.archived_at.is_(None), Task.status == status)
    if exclude_id is not None:
        stmt = stmt.where(Task.id != exclude_id)
    stmt = stmt.order_by(Task.position)
    return list(db.execute(stmt).scalars().all())


def list_done_unarchived_tasks(db: Session) -> list[Task]:
    """Every Done, unarchived task — the candidate set for issue #32's
    archive job.

    Deliberately not filtered further by `completed_at` here: that would
    be a second copy of the seven-day window outside `domain/` (binding
    rule 5). The job checks every candidate this returns against
    `domain.archive_policy.is_eligible_for_archive`, which owns the rule
    exclusively.
    """
    stmt = select(Task).where(Task.archived_at.is_(None), Task.status == TaskStatus.DONE)
    return list(db.execute(stmt).scalars().all())


def get_active_task(db: Session, task_id: uuid.UUID) -> Task | None:
    """The task with `task_id`, or `None` if it does not exist or is
    archived — an archived task is 404 here; #30 owns `/archive/{id}`."""
    stmt = select(Task).where(Task.id == task_id, Task.archived_at.is_(None))
    return db.execute(stmt).scalar_one_or_none()


def create_task(db: Session, task: Task) -> Task:
    """Add `task` and flush so its server-generated fields (and the
    position/timestamps the router set explicitly) are visible on the
    returned instance immediately — the router builds its response from
    this object without a separate read."""
    db.add(task)
    db.flush()
    return task


def delete_task(db: Session, task: Task) -> None:
    """Hard-delete `task`. No other row is touched — a deleted task's
    former column keeps every remaining task's `position` (spec: #24's
    float positions need no renumbering after a removal)."""
    db.delete(task)
    db.flush()


# --- Shared write path: create, update, move (issue #28, #29, #41) ---------


def _apply_column_changes(
    changes: dict[uuid.UUID, float], others_by_id: dict[uuid.UUID, Task]
) -> None:
    """Write every position `ordering` returned back onto the loaded ORM
    rows in `others_by_id` — the moved task itself is set by the caller."""
    for task_id, position in changes.items():
        other = others_by_id.get(task_id)
        if other is not None:
            other.position = position


def create_task_from_request(db: Session, body: TaskCreate, now: datetime) -> Task:
    """`POST /tasks`'s full create logic (spec §6.1 defaults): appends to
    the end of `body.status`'s column (Todo by default — issue #41's
    chat-created tasks rely on this same default) and resolves
    `completed_at` through the one shared rule."""
    task_id = uuid.uuid4()

    column_tasks = list_active_tasks_by_status(db, body.status)
    target = [(task.id, task.position) for task in column_tasks]
    changes = ordering.move_to_column([(task_id, 0.0)], target, task_id, len(target))

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

    return create_task(db, task)


def apply_task_update(db: Session, task: Task, body: TaskUpdate, now: datetime) -> Task:
    """`PATCH /tasks/{id}`'s full partial-update logic: only the fields
    `body` actually sets (`model_dump(exclude_unset=True)`) are touched, a
    `status` change re-runs the ordering/`completed_at` rules exactly like
    a move, and every other field change is a plain attribute set."""
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
                for t in list_active_tasks_by_status(db, previous_status)
            ]
            target_tasks = list_active_tasks_by_status(
                db, new_status, exclude_id=task.id
            )
            target = [(t.id, t.position) for t in target_tasks]
            changes = ordering.move_to_column(source, target, task.id, len(target))
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


def apply_task_move(db: Session, task: Task, body: TaskMove, now: datetime) -> Task:
    """`POST /tasks/{id}/move`'s full move logic (board drag, or an
    AI-confirmed move — issue #29, #41), cross-column or within one column.
    `completed_at` always goes through `resolve_completed_at` — entering,
    leaving and staying in Done are all handled by that one rule, never
    re-implemented here. Raises `ValueError` for a bad `body.index` (the
    caller turns it into a `422`, or #41 never produces one since it always
    computes the target column's own current length)."""
    previous_status = task.status
    new_status = body.status

    if new_status == previous_status:
        column_tasks = list_active_tasks_by_status(db, previous_status)
        column = [(t.id, t.position) for t in column_tasks]
        changes = ordering.reorder_within_column(column, task.id, body.index)
        _apply_column_changes(changes, {t.id: t for t in column_tasks})
    else:
        source_tasks = list_active_tasks_by_status(db, previous_status)
        source = [(t.id, t.position) for t in source_tasks]
        target_tasks = list_active_tasks_by_status(db, new_status, exclude_id=task.id)
        target = [(t.id, t.position) for t in target_tasks]
        changes = ordering.move_to_column(source, target, task.id, body.index)
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
    return task


# --- Archive (spec §9.2, issue #30) -----------------------------------------


def _escape_like(term: str) -> str:
    """Escape a user-supplied substring for a `LIKE`/`ILIKE` pattern so `%`
    and `_` match themselves literally rather than acting as wildcards.

    The backslash is escaped first — otherwise a term already containing one
    would have its escaping doubled by the two replacements that follow.
    Pure string manipulation, no I/O; the caller wraps the result in `%...%`
    and passes `escape="\\"` to `ilike`.
    """
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def get_archived_task(db: Session, task_id: uuid.UUID) -> Task | None:
    """The task with `task_id`, or `None` if it does not exist or is not
    archived — an active task's id is 404 here; `db.task_repository.
    get_active_task` owns `/tasks/{id}`."""
    stmt = select(Task).where(Task.id == task_id, Task.archived_at.is_not(None))
    return db.execute(stmt).scalar_one_or_none()


def list_archived_tasks(
    db: Session, *, search: str | None, page: int, page_size: int
) -> tuple[list[Task], int]:
    """Archived tasks matching `search` (title only, case-insensitive,
    literal `%`/`_`, trimmed; blank or `None` means no filter), newest
    completion first, ties broken by `archived_at` then `id` descending/
    ascending as documented on `TaskResponse` ordering (spec §9.2).

    Returns `(page_items, total_matching)` — `total_matching` counts every
    archived task matching `search`, not just the requested page, so the
    caller can report an accurate `total` alongside a possibly-empty page
    past the last one.
    """
    base_filter = Task.archived_at.is_not(None)
    term = (search or "").strip()

    stmt = select(Task).where(base_filter)
    count_stmt = select(func.count()).select_from(Task).where(base_filter)
    if term:
        condition = Task.title.ilike(f"%{_escape_like(term)}%", escape="\\")
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)

    total = db.execute(count_stmt).scalar_one()

    stmt = (
        stmt.order_by(
            Task.completed_at.desc(), Task.archived_at.desc(), Task.id.asc()
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = list(db.execute(stmt).scalars().all())
    return items, total
