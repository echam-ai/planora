"""Scope existing data to Hamster Knight and enable Ech Princess.

Revision ID: 209e984e239b
Revises: ea8f66633290

Reviewed autogeneration: use portable batch alterations for SQLite, add the
CHECK changes autogeneration cannot detect, and backfill ownership through
server_default=1 without rewriting existing values or timestamps. Profiles
are a fixed API catalog, so an empty database requires no credential seed.
"""
import sqlalchemy as sa

from alembic import op

revision = "209e984e239b"
down_revision = "ea8f66633290"
branch_labels = None
depends_on = None


OWNED_TABLES = ("task", "chat_message", "chat_action")


def upgrade() -> None:
    for table in OWNED_TABLES:
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("profile_id", sa.Integer(), nullable=False, server_default="1"))
            batch.create_check_constraint(f"ck_{table}_profile", "profile_id IN (1, 2)")
            batch.create_index(f"ix_{table}_profile_id", ["profile_id"])
            if table == "chat_message":
                batch.drop_constraint("uq_chat_message_sequence", type_="unique")
                batch.create_unique_constraint("uq_chat_message_profile_sequence", ["profile_id", "sequence"])
    for table in ("app_settings", "conversation"):
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"ck_{table}_single_row", type_="check")
            batch.create_check_constraint(f"ck_{table}_profiles", "id IN (1, 2)")
    # Invalidate retired sessions; existing task/chat/settings data is untouched.
    op.execute(sa.text("DELETE FROM auth_session"))
    op.execute(sa.text("DELETE FROM login_failure"))
    op.execute(sa.text("DELETE FROM app_user"))


def downgrade() -> None:
    # A downgrade cannot represent Princess data in the single-profile schema.
    # Fail before DDL instead of deleting or merging either account's content.
    connection = op.get_bind()
    for table in (*OWNED_TABLES, "app_settings", "conversation"):
        column = "profile_id" if table in OWNED_TABLES else "id"
        if connection.execute(sa.text(f"SELECT COUNT(*) FROM {table} WHERE {column} = 2")).scalar():
            raise RuntimeError("Cannot downgrade while Ech Princess has stored data.")
    for table in ("app_settings", "conversation"):
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"ck_{table}_profiles", type_="check")
            batch.create_check_constraint(f"ck_{table}_single_row", "id = 1")
    for table in reversed(OWNED_TABLES):
        with op.batch_alter_table(table) as batch:
            if table == "chat_message":
                batch.drop_constraint("uq_chat_message_profile_sequence", type_="unique")
                batch.create_unique_constraint("uq_chat_message_sequence", ["sequence"])
            batch.drop_index(f"ix_{table}_profile_id")
            batch.drop_constraint(f"ck_{table}_profile", type_="check")
            batch.drop_column("profile_id")
