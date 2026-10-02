"""Alembic must accept URL-encoded passwords without ConfigParser interpolation."""
from io import StringIO
from pathlib import Path

from alembic.config import Config

from alembic import command


def test_offline_postgresql_history_accepts_percent_encoded_password(valid_env, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:encoded%25password@db:5432/planora")
    output = StringIO()
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"), output_buffer=output)
    command.upgrade(config, "head", sql=True)
    sql = output.getvalue()
    for name in ("ck_chat_message_role", "ck_chat_action_kind", "ck_chat_action_status"):
        assert sql.count(f"CONSTRAINT {name} CHECK") == 1
    assert "encoded%25password" not in sql
