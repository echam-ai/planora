"""Integration tests for `planora_api.db.session`.

The session factory must build its engine from `Settings.database_url`
(read through `load_settings()`) and nothing else — no other environment
variable, no hard-coded URL.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine as independent_engine
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.config import load_settings
from planora_api.db.models import Task, TaskCategory, TaskPriority, TaskStatus
from planora_api.db.session import create_session_factory, session_scope

# tests/integration/test_db_session.py -> tests -> apps/api -> repo root
_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCRATCH_DIR = _REPO_ROOT / ".tmp" / "issue-22-session-tests"


def test_session_writes_only_to_the_configured_database(
    migrated_database_url: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    decoy_path = tmp_path / "decoy.db"
    monkeypatch.setenv("UNRELATED_DATABASE_URL", f"sqlite:///{decoy_path}")

    try:
        settings = load_settings()
        assert settings.database_url == migrated_database_url

        session_factory = create_session_factory(settings)
        with session_factory() as session:
            session.add(
                Task(
                    title="Write to the configured file",
                    content="body",
                    status=TaskStatus.TODO,
                    category=TaskCategory.WORK,
                    priority=TaskPriority.LOW,
                    position=0.0,
                )
            )
            session.commit()
        session_factory.kw["bind"].dispose()
        assert not decoy_path.exists()

        # A brand-new sqlite3 connection, independent of the SQLAlchemy
        # engine above, sees the row — proving the write landed in
        # `settings.database_url` and nowhere else.
        engine = independent_engine(migrated_database_url)
        try:
            with engine.connect() as connection:
                count = connection.execute(select(func.count()).select_from(Task)).scalar_one()
        finally:
            engine.dispose()
        assert count == 1
    finally:
        session_factory.kw["bind"].dispose()


def test_session_scope_commits_on_success_and_rolls_back_on_error(
    migrated_session_factory: sessionmaker[Session],
) -> None:
    session_factory = migrated_session_factory

    def _task(title: str) -> Task:
        return Task(title=title, content="body", status=TaskStatus.TODO, category=TaskCategory.WORK, priority=TaskPriority.LOW, position=0.0)

    # A transaction that raises leaves no partial write behind.
    with pytest.raises(RuntimeError), session_scope(session_factory) as session:
        session.add(_task("never committed"))
        session.flush()
        raise RuntimeError("boom")

    # A transaction that completes normally is committed.
    with session_scope(session_factory) as session:
        session.add(_task("committed"))

    with session_factory() as session:
        titles = [task.title for task in session.query(Task).all()]
    assert titles == ["committed"]
