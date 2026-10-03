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
from sqlalchemy import CheckConstraint, Enum, Float, Integer, Text, UniqueConstraint
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
    """A profile-owned task; ownership is server-only, not a wire field."""

    __tablename__ = "task"
    __table_args__ = (CheckConstraint("profile_id IN (1, 2)", name="ck_task_profile"),)
    profile_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)

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
    """Retired credential table retained to preserve historical migration metadata."""

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


class AppSettings(Base):
    """One overrides row per fixed profile (id 1 or 2); NULL follows deployment defaults."""

    __tablename__ = "app_settings"
    __table_args__ = (CheckConstraint("id IN (1, 2)", name="ck_app_settings_profiles"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    timezone: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    model_name: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now, onupdate=_utc_now
    )


class AuthSession(Base):
    """Retired session table; the profile migration empties it and no runtime code uses it."""

    __tablename__ = "auth_session"

    token_digest: Mapped[str] = mapped_column(Text, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now
    )
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)


class ChatRole(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"


class Conversation(Base):
    """One current conversation per profile, keyed by profile id; reset replaces only its wire UUID."""

    __tablename__ = "conversation"
    __table_args__ = (CheckConstraint("id IN (1, 2)", name="ck_conversation_profiles"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        _Uuid(as_uuid=True), nullable=False, default=uuid.uuid4
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now, onupdate=_utc_now
    )


class ChatMessage(Base):
    """A profile-owned message, uniquely ordered by (profile_id, sequence), removed on that profile reset."""

    __tablename__ = "chat_message"
    __table_args__ = (
        UniqueConstraint("profile_id", "sequence", name="uq_chat_message_profile_sequence"),
        CheckConstraint("profile_id IN (1, 2)", name="ck_chat_message_profile"),
    )
    profile_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)

    id: Mapped[uuid.UUID] = mapped_column(
        _Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[ChatRole] = mapped_column(
        Enum(
            ChatRole,
            name="ck_chat_message_role",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=_enum_values,
            length=20,
        ),
        nullable=False,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now
    )


class ChatActionKind(str, enum.Enum):
    CREATE = "create"
    UPDATE = "update"
    MOVE = "move"
    SCHEDULE = "schedule"


class ChatActionStatus(str, enum.Enum):
    PENDING = "pending"
    APPLIED = "applied"
    REJECTED = "rejected"


class ChatAction(Base):
    """A profile-owned proposal attached to an assistant message; never applied without confirmation."""

    __tablename__ = "chat_action"
    __table_args__ = (CheckConstraint("profile_id IN (1, 2)", name="ck_chat_action_profile"),)
    profile_id: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1", index=True)

    id: Mapped[uuid.UUID] = mapped_column(
        _Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    message_id: Mapped[uuid.UUID] = mapped_column(_Uuid(as_uuid=True), nullable=False)
    kind: Mapped[ChatActionKind] = mapped_column(
        Enum(
            ChatActionKind,
            name="ck_chat_action_kind",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=_enum_values,
            length=20,
        ),
        nullable=False,
    )
    status: Mapped[ChatActionStatus] = mapped_column(
        Enum(
            ChatActionStatus,
            name="ck_chat_action_status",
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            values_callable=_enum_values,
            length=20,
        ),
        nullable=False,
        default=ChatActionStatus.PENDING,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    fields: Mapped[list[dict[str, Any]]] = mapped_column(_JSON, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(_JSON, nullable=False)
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        _Uuid(as_uuid=True), nullable=True, default=None
    )
    stale_snapshot: Mapped[dict[str, Any]] = mapped_column(
        _JSON, nullable=False, default=dict
    )
    changed_fields: Mapped[dict[str, Any] | None] = mapped_column(
        _JSON, nullable=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=_utc_now, onupdate=_utc_now
    )


class LoginFailure(Base):
    """Retired login-limit table; retained only for historical schema compatibility."""

    __tablename__ = "login_failure"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_ip: Mapped[str] = mapped_column(Text, nullable=False)
    failed_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
