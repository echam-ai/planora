"""Wire schemas for `/api/v1/tasks` (spec §5).

`snake_case` field names, matching the wire contract exactly (binding rule
2) — conversion to the web tier's `camelCase` model happens only in the web
tier's HTTP mapper, never here. The API tier is the only authority on
these rules (binding rule 1): every check below runs regardless of what the
web form already validates.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

from planora_api.db.models import TaskCategory, TaskPriority, TaskStatus

_ALLOWED_URL_SCHEMES = frozenset({"http", "https"})


def _non_blank(value: str, field_name: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError(f"{field_name} must not be blank")
    return stripped


def _to_utc(value: datetime | None) -> datetime | None:
    return value.astimezone(UTC) if value is not None else None


class TaskUrl(BaseModel):
    """One URL entry (spec §5, §8). No `id` on the wire — the web tier's
    HTTP mapper assigns a client-side id for its own `TaskUrl.id` (the
    user's non-scope decision recorded on issue #28: URL entries stay
    id-less on the wire)."""

    model_config = ConfigDict(extra="forbid")

    url: str
    label: str | None = None

    @field_validator("url")
    @classmethod
    def _url_scheme_is_safe(cls, value: str) -> str:
        # §15.1: user-provided URLs are untrusted input. Only http(s) may
        # reach a link a user could click — `javascript:` and other
        # executable schemes are rejected outright.
        scheme = urlsplit(value).scheme.lower()
        if scheme not in _ALLOWED_URL_SCHEMES:
            raise ValueError("url must use the http or https scheme")
        return value


class TaskCreate(BaseModel):
    """`POST /api/v1/tasks` request body (spec §6.1 defaults).

    Extra fields are rejected outright — both truly unknown keys and every
    server-owned field (`id`, `position`, `created_at`, `updated_at`,
    `completed_at`, `archived_at`), none of which this model declares, so
    they can never be silently dropped or, worse, silently honored.
    """

    model_config = ConfigDict(extra="forbid")

    title: str
    content: str
    status: TaskStatus = TaskStatus.TODO
    category: TaskCategory = TaskCategory.OTHER
    priority: TaskPriority = TaskPriority.MEDIUM
    deadline_at: AwareDatetime | None = None
    urls: list[TaskUrl] = Field(default_factory=list)
    markdown_note: str = ""

    @field_validator("title", "content")
    @classmethod
    def _required_non_blank(cls, value: str, info: Any) -> str:
        return _non_blank(value, info.field_name)

    @field_validator("deadline_at")
    @classmethod
    def _deadline_to_utc(cls, value: datetime | None) -> datetime | None:
        # §5: timestamps are stored in UTC regardless of the offset a
        # client sent — normalize here so the value the router persists
        # and echoes back is already the UTC instant, with no separate
        # database round-trip needed to see it.
        return _to_utc(value)


class TaskUpdate(BaseModel):
    """`PATCH /api/v1/tasks/{id}` request body — a partial update.

    Every field defaults to `None`, meaning "left out of the body" — the
    router distinguishes that from an *explicit* `null` via
    `model_dump(exclude_unset=True)`, since pydantic does not run a field's
    validators against a default value that was never supplied (only
    against a value actually present in the request, including an explicit
    `null`). An explicit `null` for a field the database stores `NOT NULL`
    (`title`, `content`, `markdown_note`, `category`, `priority`, `status`,
    `urls`) is rejected by the validators below; only `deadline_at` accepts
    an explicit `null`, which clears the deadline.
    """

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    content: str | None = None
    status: TaskStatus | None = None
    category: TaskCategory | None = None
    priority: TaskPriority | None = None
    deadline_at: AwareDatetime | None = None
    urls: list[TaskUrl] | None = None
    markdown_note: str | None = None

    @field_validator("title", "content")
    @classmethod
    def _not_null_and_non_blank(cls, value: str | None, info: Any) -> str:
        if value is None:
            raise ValueError(f"{info.field_name} must not be null")
        return _non_blank(value, info.field_name)

    @field_validator("markdown_note", "status", "category", "priority", "urls")
    @classmethod
    def _not_null(cls, value: Any, info: Any) -> Any:
        if value is None:
            raise ValueError(f"{info.field_name} must not be null")
        return value

    @field_validator("deadline_at")
    @classmethod
    def _deadline_to_utc(cls, value: datetime | None) -> datetime | None:
        return _to_utc(value)


class TaskMove(BaseModel):
    """`POST /api/v1/tasks/{task_id}/move` request body (issue #29).

    `index` is an insertion index, not a stored `position` value — for a
    move into another column it is the index among that column's existing
    tasks (`0` to `len(target)` inclusive); for a move whose `status`
    equals the task's current one it is the task's final index in its own
    column (`0` to `len(column) - 1` inclusive). Both bounds depend on the
    target column's size at request time, so only the lower bound (never
    negative) is enforced by the wire type here — the upper bound is
    checked by `domain/ordering.py` and turned into a `422` by the router;
    neither bound is ever clamped.
    """

    model_config = ConfigDict(extra="forbid")

    status: TaskStatus
    index: int = Field(ge=0)


class TaskReorder(BaseModel):
    """`POST /api/v1/tasks/reorder` request body (issue #29).

    `ordered_ids` must be an exact permutation of the ids of the active
    tasks currently in `status` — checked by `domain/ordering.reorder_column`
    and turned into a `422` by the router for a duplicate, an omission, or
    a foreign/archived/unknown id.
    """

    model_config = ConfigDict(extra="forbid")

    status: TaskStatus
    ordered_ids: list[UUID]


class TaskResponse(BaseModel):
    """The full task wire shape — exactly the 14 §5 fields, nothing else."""

    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: UUID
    title: str
    content: str
    status: TaskStatus
    category: TaskCategory
    priority: TaskPriority
    deadline_at: datetime | None
    urls: list[TaskUrl]
    markdown_note: str
    position: float
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    archived_at: datetime | None
