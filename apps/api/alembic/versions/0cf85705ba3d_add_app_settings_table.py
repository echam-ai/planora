"""add app settings table

Revision ID: 0cf85705ba3d
Revises: cbbec2744527
Create Date: 2026-09-28 17:55:03.296353

Hand-corrected after autogeneration (binding rule 4): added the missing
`planora_api.db.types` import — the candidate revision referenced
`planora_api.db.types.UTCDateTime` without importing it and would have
failed at import time, exactly like `cbbec2744527` before it. Also
switched the typing imports and identifiers to this project's style
(`from __future__ import annotations`, PEP 604 unions) to match
`7c8527c2816c` and `cbbec2744527`.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

import planora_api.db.types
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0cf85705ba3d"
down_revision: str | Sequence[str] | None = "cbbec2744527"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("timezone", sa.Text(), nullable=True),
        sa.Column("model_name", sa.Text(), nullable=True),
        sa.Column("updated_at", planora_api.db.types.UTCDateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_app_settings_single_row"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("app_settings")
