"""add auth tables

Revision ID: cbbec2744527
Revises: 7c8527c2816c
Create Date: 2026-09-26 11:02:26.514185

Hand-corrected after autogeneration (binding rule 4): added the missing
`planora_api.db.types` import — the candidate revision referenced
`planora_api.db.types.UTCDateTime` without importing it and would have
failed at import time, exactly like the task-table revision it follows.
Also switched the typing imports and identifiers to this project's style
(`from __future__ import annotations`, PEP 604 unions) to match
`7c8527c2816c`.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

import planora_api.db.types
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cbbec2744527"
down_revision: str | Sequence[str] | None = "7c8527c2816c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "app_user",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("created_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_app_user_single_row"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "auth_session",
        sa.Column("token_digest", sa.Text(), nullable=False),
        sa.Column("created_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False),
        sa.Column("expires_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("token_digest"),
    )
    op.create_table(
        "login_failure",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("client_ip", sa.Text(), nullable=False),
        sa.Column("failed_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("login_failure")
    op.drop_table("auth_session")
    op.drop_table("app_user")
