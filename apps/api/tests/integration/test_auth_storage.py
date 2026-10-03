"""Integration tests for the `app_user`, `auth_session` and `login_failure`
tables and their Alembic revision (issue #25).

Every test here uses `migrated_session_factory`/`migrated_database_url` (see
`conftest.py`), which apply the Alembic migration to a disposable SQLite
file under the repo's `.tmp/` — never `metadata.create_all` and never
`pytest`'s `tmp_path` — so these exercise exactly what
`uv run alembic upgrade head` produces.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from planora_api.db.models import AppUser

_EXPECTED_APP_USER_COLUMNS = {"id", "username", "password_hash", "created_at", "updated_at"}
_EXPECTED_AUTH_SESSION_COLUMNS = {"token_digest", "created_at", "expires_at"}
_EXPECTED_LOGIN_FAILURE_COLUMNS = {"id", "client_ip", "failed_at"}


def test_upgrade_head_creates_all_three_auth_tables(migrated_database_url: str) -> None:
    engine = create_engine(migrated_database_url)
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())

    assert {"app_user", "auth_session", "login_failure"} <= table_names

    assert {c["name"] for c in inspector.get_columns("app_user")} == _EXPECTED_APP_USER_COLUMNS
    assert (
        {c["name"] for c in inspector.get_columns("auth_session")}
        == _EXPECTED_AUTH_SESSION_COLUMNS
    )
    assert (
        {c["name"] for c in inspector.get_columns("login_failure")}
        == _EXPECTED_LOGIN_FAILURE_COLUMNS
    )
    engine.dispose()


def test_downgrade_then_upgrade_recreates_the_auth_tables(
    migrated_database_url: str, alembic_config: Config
) -> None:
    command.downgrade(alembic_config, "7c8527c2816c")
    engine = create_engine(migrated_database_url)
    table_names = set(inspect(engine).get_table_names())
    assert not {"app_user", "auth_session", "login_failure"} & table_names
    assert "task" in table_names  # the prior revision's table is untouched
    engine.dispose()

    command.upgrade(alembic_config, "head")
    engine = create_engine(migrated_database_url)
    table_names = set(inspect(engine).get_table_names())
    assert {"app_user", "auth_session", "login_failure"} <= table_names
    engine.dispose()


def test_second_app_user_row_is_rejected_by_the_database(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    now = datetime.now(UTC)
    with migrated_session_factory() as session:
        session.add(
            AppUser(id=1, username="owner", password_hash="$argon2id$fake", created_at=now, updated_at=now)
        )
        session.commit()

    with migrated_session_factory() as session:
        session.add(
            AppUser(id=2, username="intruder", password_hash="$argon2id$fake", created_at=now, updated_at=now)
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

    with migrated_session_factory() as session:
        remaining_ids = [row.id for row in session.query(AppUser).all()]
        assert remaining_ids == [1]
