"""Integration tests for the Alembic migration itself (issue #22 scenarios:
"Operator migrates an empty SQLite database" and "Migration history is
reversible").
"""

from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command

_EXPECTED_COLUMNS = {
    "id",
    "title",
    "content",
    "status",
    "category",
    "priority",
    "deadline_at",
    "urls",
    "markdown_note",
    "position",
    "created_at",
    "updated_at",
    "completed_at",
    "archived_at",
}


def test_upgrade_head_creates_the_task_table_with_all_columns(
    migrated_db_path: Path,
) -> None:
    engine = create_engine(f"sqlite:///{migrated_db_path}")
    inspector = inspect(engine)

    assert "task" in inspector.get_table_names()
    column_names = {column["name"] for column in inspector.get_columns("task")}
    assert column_names == _EXPECTED_COLUMNS
    engine.dispose()


def test_downgrade_then_upgrade_recreates_the_task_table(
    migrated_db_path: Path,
    alembic_config: Config,
) -> None:
    command.downgrade(alembic_config, "base")
    engine = create_engine(f"sqlite:///{migrated_db_path}")
    assert "task" not in inspect(engine).get_table_names()
    engine.dispose()

    command.upgrade(alembic_config, "head")
    engine = create_engine(f"sqlite:///{migrated_db_path}")
    inspector = inspect(engine)
    assert "task" in inspector.get_table_names()
    column_names = {column["name"] for column in inspector.get_columns("task")}
    assert column_names == _EXPECTED_COLUMNS
    engine.dispose()


# --- issue #31: app_settings ------------------------------------------------

_EXPECTED_APP_SETTINGS_COLUMNS = {"id", "timezone", "model_name", "updated_at"}


def test_upgrade_head_creates_the_app_settings_table_with_all_columns(
    migrated_db_path: Path,
) -> None:
    engine = create_engine(f"sqlite:///{migrated_db_path}")
    inspector = inspect(engine)

    assert "app_settings" in inspector.get_table_names()
    column_names = {column["name"] for column in inspector.get_columns("app_settings")}
    assert column_names == _EXPECTED_APP_SETTINGS_COLUMNS
    engine.dispose()


def test_downgrade_one_step_drops_the_app_settings_table_and_upgrade_recreates_it(
    migrated_db_path: Path,
    alembic_config: Config,
) -> None:
    command.downgrade(alembic_config, "-1")
    engine = create_engine(f"sqlite:///{migrated_db_path}")
    assert "app_settings" not in inspect(engine).get_table_names()
    # The task table (created by an earlier revision) is unaffected by
    # this one-step downgrade.
    assert "task" in inspect(engine).get_table_names()
    engine.dispose()

    command.upgrade(alembic_config, "head")
    engine = create_engine(f"sqlite:///{migrated_db_path}")
    inspector = inspect(engine)
    assert "app_settings" in inspector.get_table_names()
    column_names = {column["name"] for column in inspector.get_columns("app_settings")}
    assert column_names == _EXPECTED_APP_SETTINGS_COLUMNS
    engine.dispose()
