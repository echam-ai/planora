"""add chat conversation and message tables

Revision ID: ef184dd6772f
Revises: 0cf85705ba3d
Create Date: 2026-09-29 00:32:50.762017

Hand-corrected after autogeneration (binding rule 4), same two problems as
`0cf85705ba3d` before it:
- Added the missing `planora_api.db.types` import — the candidate revision
  referenced `planora_api.db.types.UTCDateTime` without importing it and
  would have failed at import time.
- Switched the typing imports and identifiers to this project's style
  (`from __future__ import annotations`, PEP 604 unions) to match
  `7c8527c2816c`, `cbbec2744527` and `0cf85705ba3d`.

A third, new problem: autogenerate emitted `role`'s `CHECK` constraint
twice — once implicitly from `Enum(..., create_constraint=True)` and once
as an explicit `sa.CheckConstraint`, both named `ck_chat_message_role`.
Creating the same-named constraint twice in one `CREATE TABLE` is rejected
by SQLite and would also be rejected by PostgreSQL, so the duplicate line
is removed, keeping one `CheckConstraint('role IN (...)', ...)`.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

import planora_api.db.types
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ef184dd6772f"
down_revision: str | Sequence[str] | None = "0cf85705ba3d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "chat_message",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "user",
                "assistant",
                name="ck_chat_message_role",
                native_enum=False,
                create_constraint=True,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "created_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False
        ),
        sa.CheckConstraint("role IN ('user', 'assistant')", name="ck_chat_message_role"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sequence", name="uq_chat_message_sequence"),
    )
    op.create_table(
        "conversation",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False
        ),
        sa.Column(
            "updated_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False
        ),
        sa.CheckConstraint("id = 1", name="ck_conversation_single_row"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("conversation")
    op.drop_table("chat_message")
