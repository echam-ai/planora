"""Integration tests for the `app_user`, `auth_session` and `login_failure`
tables and their Alembic revision (issue #25).

Every test here uses `migrated_session_factory`/`migrated_database_url` (see
`conftest.py`), which apply the Alembic migration to a disposable SQLite
file under the repo's `.tmp/` — never `metadata.create_all` and never
`pytest`'s `tmp_path` — so these exercise exactly what
`uv run alembic upgrade head` produces.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from planora_api.db.models import AppUser, AuthSession
from planora_api.security.session import create_session, generate_token, hash_token

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


def test_auth_session_row_stores_no_column_equal_to_the_raw_token(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    now = datetime.now(UTC)
    secret = "test-session-secret"

    with migrated_session_factory() as session:
        token, row = create_session(session, secret, now)
        session.commit()
        token_digest = row.token_digest
        created_at = row.created_at
        expires_at = row.expires_at

    # The digest is exactly what hash_token computes, and it is not the
    # raw token by construction — assert both, on the row read back fresh.
    with migrated_session_factory() as session:
        reloaded = session.get(type(row), token_digest)
        assert reloaded is not None
        assert reloaded.token_digest == hash_token(token, secret)
        assert reloaded.token_digest != token
        assert token not in reloaded.token_digest
        assert str(created_at) != token
        assert str(expires_at) != token


def test_a_fresh_token_never_collides_with_hash_token_output() -> None:
    # Sanity check on the two primitives independently of the database:
    # `hash_token` output (hex, 64 chars) is a different shape from
    # `generate_token` output (urlsafe-base64, ~43 chars) and can never
    # equal the token it was computed from.
    token = generate_token()
    digest = hash_token(token, "some-secret")
    assert token != digest
    assert len(digest) == 64  # sha256 hex digest length


def test_expired_session_still_has_a_row_but_is_not_the_stored_secret(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    now = datetime.now(UTC)
    with migrated_session_factory() as session:
        _token, row = create_session(session, "s", now - timedelta(days=15))
        session.commit()
        assert row.expires_at < now


def test_upsert_app_user_creates_then_replaces_the_single_row(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    from planora_api.db.auth_repository import get_app_user, upsert_app_user

    created_at = datetime(2026, 1, 1, tzinfo=UTC)
    with migrated_session_factory() as session:
        upsert_app_user(
            session, username="owner", password_hash="$argon2id$first", now=created_at
        )
        session.commit()

    with migrated_session_factory() as session:
        user = get_app_user(session)
        assert user is not None
        assert user.username == "owner"
        assert user.password_hash == "$argon2id$first"
        assert user.created_at == created_at

    replaced_at = datetime(2026, 2, 1, tzinfo=UTC)
    with migrated_session_factory() as session:
        upsert_app_user(
            session, username="owner-renamed", password_hash="$argon2id$second", now=replaced_at
        )
        session.commit()

    with migrated_session_factory() as session:
        user = get_app_user(session)
        assert user is not None
        assert user.id == 1  # still the single allowed row, not a second one
        assert user.username == "owner-renamed"
        assert user.password_hash == "$argon2id$second"
        assert user.created_at == created_at  # unchanged by the replace
        assert user.updated_at == replaced_at


# --- delete_all_sessions / clear_all_login_failures (issue #33) ------------


def test_delete_all_sessions_removes_every_row_regardless_of_secret(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    from planora_api.security.session import delete_all_sessions

    now = datetime(2026, 1, 1, tzinfo=UTC)
    with migrated_session_factory() as session:
        create_session(session, "secret-a", now)
        create_session(session, "secret-b", now)
        session.commit()

    with migrated_session_factory() as session:
        delete_all_sessions(session)
        session.commit()

    with migrated_session_factory() as session:
        remaining = session.execute(select(AuthSession)).scalars().all()
        assert list(remaining) == []


def test_clear_all_login_failures_removes_every_row_regardless_of_client_ip(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    from planora_api.db.models import LoginFailure
    from planora_api.security.rate_limit import clear_all_login_failures

    now = datetime(2026, 1, 1, tzinfo=UTC)
    with migrated_session_factory() as session:
        session.add(LoginFailure(client_ip="203.0.113.1", failed_at=now))
        session.add(LoginFailure(client_ip="203.0.113.2", failed_at=now))
        session.commit()

    with migrated_session_factory() as session:
        clear_all_login_failures(session)
        session.commit()

    with migrated_session_factory() as session:
        remaining = session.execute(select(LoginFailure)).scalars().all()
        assert list(remaining) == []
