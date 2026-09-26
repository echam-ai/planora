"""The task table (spec §5) and its SQLAlchemy model.

Only generic, portable column types are used here (`Uuid`, `Enum` with
`native_enum=False`, `JSON`, `Float`, `Text`, and this module's own
`UTCDateTime`) — nothing from `sqlalchemy.dialects` and no SQLite-only type,
so the same model produces valid DDL for SQLite and PostgreSQL.
"""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON as _JSON
from sqlalchemy import CheckConstraint, Enum, Float, Integer, Text
from sqlalchemy import Uuid as _Uuid
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from planora_api.db.types import UTCDateTime


class Base(DeclarativeBase):
    """Declarative base shared by every model in this package."""


class TaskStatus(str, enum.Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    DONE = "done"


class TaskCategory(str, enum.Enum):
    WORK = "work"
    PERSONAL = "personal"
    STUDY = "study"
    OTHER = "other"


class TaskPriority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _enum_values(enum_class: type[enum.Enum]) -> list[str]:
    """Store each member's wire *value* (e.g. `"in_progress"`), not its
    Python name (`"IN_PROGRESS"`) — SQLAlchemy's `Enum` uses the name by
    default, which would silently break the §5 wire contract."""
    return [member.value for member in enum_class]


class Task(Base):
    """The task row — exactly the 14 wire fields in spec §5."""

    __tablename__ = "task"

    id: Mapped[uuid.UUID] = mapped_column(
        _Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(
            TaskStatus,
            name="ck_task_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=_enum_values,
            length=20,
        ),
        nullable=False,
    )
    category: Mapped[TaskCategory] = mapped_column(
        Enum(
            TaskCategory,
            name="ck_task_category",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=_enum_values,
            length=20,
        ),
        nullable=False,
    )
    priority: Mapped[TaskPriority] = mapped_column(
        Enum(
            TaskPriority,
            name="ck_task_priority",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=_enum_values,
            length=20,
        ),
        nullable=False,
    )
    deadline_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True, default=None
    )
    urls: Mapped[list[dict[str, Any]]] = mapped_column(
        _JSON, nullable=False, default=list
    )
    markdown_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    position: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now, onupdate=_utc_now
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True, default=None
    )
    archived_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True, default=None
    )


class AppUser(Base):
    """The single account row (issue #25, spec §3.1).

    `CHECK (id = 1)` enforces exactly one account at the database layer, not
    just in application code — a second row can never be inserted, on
    SQLite or PostgreSQL. The table is named `app_user`, not `user`, because
    `user` is a reserved word in PostgreSQL.

    #25 creates this table but never inserts into it: #33's command calls
    `db.auth_repository.upsert_app_user` to create the account on first run
    and reset it later.
    """

    __tablename__ = "app_user"
    __table_args__ = (CheckConstraint("id = 1", name="ck_app_user_single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    username: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now, onupdate=_utc_now
    )


class AuthSession(Base):
    """A server-side session (issue #25).

    `token_digest` stores only `HMAC-SHA256(SESSION_SECRET, token)` — never
    the raw cookie token — so a database read alone cannot produce a working
    cookie, and rotating `SESSION_SECRET` invalidates every session.
    """

    __tablename__ = "auth_session"

    token_digest: Mapped[str] = mapped_column(Text, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now
    )
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)


class LoginFailure(Base):
    """One failed login attempt, keyed by client IP (issue #25).

    Rows outside the 15-minute rate-limit window are pruned on write by
    `security/rate_limit.py`; this table is the only state behind the
    limit, so it survives a process restart.
    """

    __tablename__ = "login_failure"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_ip: Mapped[str] = mapped_column(Text, nullable=False)
    failed_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
