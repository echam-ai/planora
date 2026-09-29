"""add chat action table

Revision ID: ea8f66633290
Revises: ef184dd6772f
Create Date: 2026-09-29 11:07:44.231639

Hand-corrected after autogeneration (binding rule 4), the same two problems
`ef184dd6772f` before it had:
- Added the missing `planora_api.db.types` import — the candidate revision
  referenced `planora_api.db.types.UTCDateTime` without importing it and
  would have failed at import time.
- Switched the typing imports and identifiers to this project's style
  (`from __future__ import annotations`, PEP 604 unions) to match
  `7c8527c2816c`, `cbbec2744527`, `0cf85705ba3d` and `ef184dd6772f`.

A third, familiar problem: autogenerate emitted both `kind`'s and
`status`'s `CHECK` constraint twice each — once implicitly from
`Enum(..., create_constraint=True)` and once as an explicit
`sa.CheckConstraint`, both pairs sharing a name. Creating the same-named
constraint twice in one `CREATE TABLE` is rejected by SQLite and would also
be rejected by PostgreSQL, so each duplicate line is removed, keeping one
`CheckConstraint(...)` per column.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

import planora_api.db.types
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ea8f66633290"
down_revision: str | Sequence[str] | None = "ef184dd6772f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "chat_action",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "create",
                "update",
                "move",
                "schedule",
                name="ck_chat_action_kind",
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "applied",
                "rejected",
                name="ck_chat_action_status",
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("fields", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("stale_snapshot", sa.JSON(), nullable=False),
        sa.Column("changed_fields", sa.JSON(), nullable=True),
        sa.Column(
            "created_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False
        ),
        sa.Column(
            "updated_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False
        ),
        sa.CheckConstraint(
            "kind IN ('create', 'update', 'move', 'schedule')", name="ck_chat_action_kind"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'applied', 'rejected')", name="ck_chat_action_status"
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("chat_action")
