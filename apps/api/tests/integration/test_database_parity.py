"""Migration and persistence assertions collected identically for both engines."""
import uuid
from datetime import UTC, datetime, timedelta, timezone

import pytest
from alembic.script import ScriptDirectory
from sqlalchemy import MetaData, create_engine, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from planora_api.config import load_settings
from planora_api.db.models import AppSettings, AppUser, ChatMessage, Task


def test_fixture_uses_selected_backend(migrated_database_url, pytestconfig):
    expected = pytestconfig.getoption("db_backend")
    engine = create_engine(migrated_database_url)
    try:
        with engine.connect() as connection:
            assert connection.dialect.name == expected
            assert load_settings().database_url == migrated_database_url
            if expected == "postgresql":
                assert connection.execute(text("select current_schema()")).scalar_one().startswith("planora_test_")
    finally:
        engine.dispose()


def test_empty_history_is_idempotent_and_has_expected_schema(database_url, alembic_config):
    command.upgrade(alembic_config, "head")
    command.upgrade(alembic_config, "head")
    engine = create_engine(database_url)
    try:
        inspector = inspect(engine)
        assert {"task", "app_user", "auth_session", "login_failure", "app_settings", "conversation", "chat_message", "chat_action"} <= set(inspector.get_table_names())
        checks = {c["name"] for c in inspector.get_check_constraints("chat_action")}
        assert {"ck_chat_action_kind", "ck_chat_action_status"} <= checks
        assert "uq_chat_message_profile_sequence" in {c["name"] for c in inspector.get_unique_constraints("chat_message")}
        with engine.connect() as connection:
            assert connection.execute(text("select version_num from alembic_version")).scalar_one() == ScriptDirectory.from_config(alembic_config).get_current_head()
    finally:
        engine.dispose()


def test_seeded_settings_revision_upgrade_preserves_account_settings_task(database_url, alembic_config):
    earlier = "0cf85705ba3d"
    command.upgrade(alembic_config, earlier)
    engine = create_engine(database_url)
    instant = datetime(2026, 2, 3, 12, 34, 56, 123456, tzinfo=timezone(timedelta(hours=8)))
    task_id = uuid.uuid4()
    try:
        with Session(engine) as session:
            session.add(AppUser(id=1, username="migration-owner", password_hash="hash-preserved", created_at=instant, updated_at=instant))
            session.add(AppSettings(id=1, timezone="Asia/Singapore", model_name="kimi-k3", updated_at=instant))
            metadata = MetaData()
            metadata.reflect(engine)
            session.execute(metadata.tables["task"].insert().values(
                id=task_id.hex if engine.dialect.name == "sqlite" else task_id,
                title="Preserve 100%_case", content="seeded content", status="todo", category="work", priority="high",
                position=2.5, deadline_at=instant.astimezone(UTC), created_at=instant.astimezone(UTC), updated_at=instant.astimezone(UTC),
                urls=[{"url":"https://example.com", "label":"link"}], markdown_note="**note**",
            ))
            session.commit()
        command.upgrade(alembic_config, "head")
        with Session(engine) as session:
            user = session.get(AppUser, 1)
            settings = session.get(AppSettings, 1)
            task = session.get(Task, task_id)
            assert user is None  # credentials are retired by the additive profile migration
            assert task.profile_id == 1
            assert (settings.timezone, settings.model_name, settings.updated_at) == ("Asia/Singapore", "kimi-k3", instant.astimezone(UTC))
            assert (task.id, task.title, task.content, task.position) == (task_id, "Preserve 100%_case", "seeded content", 2.5)
            assert (task.deadline_at, task.created_at, task.updated_at) == (instant.astimezone(UTC),) * 3
            assert task.urls == [{"url":"https://example.com", "label":"link"}]
            assert task.markdown_note == "**note**"
    finally:
        engine.dispose()


def test_unique_sequence_and_intentional_no_foreign_keys(migrated_session_factory):
    engine = migrated_session_factory.kw["bind"]
    # This single-conversation model deliberately keeps proposal/message IDs
    # independent; parity must preserve that rule rather than inventing FKs.
    for table in ("chat_message", "chat_action", "conversation"):
        assert inspect(engine).get_foreign_keys(table) == []
    with migrated_session_factory() as session:
        session.add(ChatMessage(id=uuid.uuid4(), sequence=1, role="user", text="first"))
        session.commit()
    with migrated_session_factory() as session:
        session.add(ChatMessage(id=uuid.uuid4(), sequence=1, role="assistant", text="duplicate"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.execute(select(ChatMessage.text)).scalars().all() == ["first"]
