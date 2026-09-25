"""create task table

Revision ID: 7c8527c2816c
Revises:
Create Date: 2026-09-25 14:56:04.681058

Hand-corrected after autogeneration (binding rule 4):
- Added the missing `planora_api.db.types` import — the candidate revision
  referenced `planora_api.db.types.UTCDateTime` without importing it and
  would have failed at import time.
- Removed the duplicate `CheckConstraint` for each enum column. Autogenerate
  emitted each one twice: once from the `Enum(..., create_constraint=True)`
  column type (which attaches its own constraint on table construction) and
  once from its own reflection of that same constraint. Creating the table
  with both left two identically named `CHECK` constraints on one table,
  which is invalid DDL. Exactly one now, matching the model in
  `planora_api/db/models.py`.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

import planora_api.db.types
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7c8527c2816c"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "task",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "todo",
                "in_progress",
                "done",
                name="ck_task_status",
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column(
            "category",
            sa.Enum(
                "work",
                "personal",
                "study",
                "other",
                name="ck_task_category",
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column(
            "priority",
            sa.Enum(
                "low",
                "medium",
                "high",
                name="ck_task_priority",
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("deadline_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=True),
        sa.Column("urls", sa.JSON(), nullable=False),
        sa.Column("markdown_note", sa.Text(), nullable=False),
        sa.Column("position", sa.Float(), nullable=False),
        sa.Column("created_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False),
        sa.Column("completed_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=True),
        sa.Column("archived_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("task")
