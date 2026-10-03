"""Upgrade populated historical data without changing a single legacy value."""
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import MetaData, create_engine, select

from alembic import command

LEGACY_HEAD = "ea8f66633290"


def test_populated_legacy_upgrade_preserves_all_data(database_url, alembic_config):
    command.upgrade(alembic_config, LEGACY_HEAD)
    engine = create_engine(database_url)
    metadata = MetaData()
    metadata.reflect(engine)
    now = datetime(2025, 2, 3, 4, 5, 6, tzinfo=UTC)
    task_id, archived_id, message_id, action_id = [uuid.uuid4() for _ in range(4)]
    wire_uuid = lambda value: value.hex if engine.dialect.name == "sqlite" else value
    with engine.begin() as db:
        for ident, archived in ((task_id, False), (archived_id, True)):
            db.execute(metadata.tables["task"].insert().values(
                id=wire_uuid(ident), title="Legacy title", content="Legacy content", status="done" if archived else "todo",
                category="study", priority="high", deadline_at=now, urls=[{"url": "https://example.com"}],
                markdown_note="**legacy**", position=3.25, created_at=now, updated_at=now,
                completed_at=now if archived else None, archived_at=now + timedelta(days=9) if archived else None,
            ))
        db.execute(metadata.tables["app_settings"].insert().values(id=1, timezone="America/New_York", model_name="legacy-model", updated_at=now))
        db.execute(metadata.tables["conversation"].insert().values(id=1, conversation_id=wire_uuid(uuid.uuid4()), created_at=now, updated_at=now))
        db.execute(metadata.tables["chat_message"].insert().values(id=wire_uuid(message_id), sequence=7, role="assistant", text="Legacy preview", created_at=now))
        for status in ("pending", "applied"):
            db.execute(metadata.tables["chat_action"].insert().values(
                id=wire_uuid(action_id if status == "pending" else uuid.uuid4()), message_id=wire_uuid(message_id),
                kind="move", status=status, title="Move", summary="Legacy title", fields=[],
                payload={"task_id": str(task_id), "status": "done"}, task_id=wire_uuid(task_id),
                stale_snapshot={"status": "todo"}, changed_fields=None, created_at=now, updated_at=now,
            ))
        db.execute(metadata.tables["app_user"].insert().values(id=1, username="legacy", password_hash="retired", created_at=now, updated_at=now))
        db.execute(metadata.tables["auth_session"].insert().values(token_digest="retired", created_at=now, expires_at=now + timedelta(days=14)))
        db.execute(metadata.tables["login_failure"].insert().values(client_ip="127.0.0.1", failed_at=now))
    owned = ("task", "app_settings", "conversation", "chat_message", "chat_action")
    with engine.connect() as db:
        before = {name: [dict(row) for row in db.execute(select(metadata.tables[name]).order_by(metadata.tables[name].c.id)).mappings()] for name in owned}
    engine.dispose()
    command.upgrade(alembic_config, "head")
    engine = create_engine(database_url)
    metadata = MetaData()
    metadata.reflect(engine)
    try:
        with engine.connect() as db:
            for name in owned:
                rows = [dict(row) for row in db.execute(select(metadata.tables[name]).order_by(metadata.tables[name].c.id)).mappings()]
                for row in rows:
                    assert row.pop("profile_id", 1) == 1
                assert rows == before[name], name
            for name in ("app_user", "auth_session", "login_failure"):
                assert db.execute(select(metadata.tables[name])).all() == []
    finally:
        engine.dispose()
