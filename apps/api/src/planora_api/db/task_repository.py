"""Repository functions for the `task` table (spec §5, issue #28).

Every function takes an already-open `Session` (`api.deps.DbSession`) and
never commits — the request-scoped `get_db` dependency commits exactly once,
after the route returns, so a partially-applied create/update/reorder is
never persisted (spec §15.1). Callers pass the resulting ORM objects
straight to `domain/ordering.py`'s `(task_id, position)` column shape and
write any resulting position change back onto these same instances.
"""

from __future__ import annotations

import uuid

from sqlalchemy import case, select
from sqlalchemy.orm import Session

from planora_api.db.models import Task, TaskStatus

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
