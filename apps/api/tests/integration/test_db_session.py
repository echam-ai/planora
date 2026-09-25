"""Integration tests for `planora_api.db.session`.

The session factory must build its engine from `Settings.database_url`
(read through `load_settings()`) and nothing else — no other environment
variable, no hard-coded URL.
"""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

import pytest

from planora_api.config import load_settings
from planora_api.db.models import Base, Task, TaskCategory, TaskPriority, TaskStatus
from planora_api.db.session import create_engine, create_session_factory, session_scope

# tests/integration/test_db_session.py -> tests -> apps/api -> repo root
_REPO_ROOT = Path(__file__).resolve().parents[3]
_SCRATCH_DIR = _REPO_ROOT / ".tmp" / "issue-22-session-tests"


def test_session_writes_only_to_the_configured_database(
    valid_env: pytest.MonkeyPatch,
) -> None:
    _SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    target_path = _SCRATCH_DIR / f"{uuid.uuid4().hex}-target.db"
    decoy_path = _SCRATCH_DIR / f"{uuid.uuid4().hex}-decoy.db"
    valid_env.setenv("DATABASE_URL", f"sqlite:///{target_path}")

    try:
        settings = load_settings()
        assert settings.database_url == f"sqlite:///{target_path}"

        engine = create_engine(settings)
        Base.metadata.create_all(engine)

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
        engine.dispose()

        assert target_path.exists()
        assert not decoy_path.exists()

        # A brand-new sqlite3 connection, independent of the SQLAlchemy
        # engine above, sees the row — proving the write landed in
        # `settings.database_url` and nowhere else.
        connection = sqlite3.connect(target_path)
        try:
            (count,) = connection.execute("SELECT COUNT(*) FROM task").fetchone()
        finally:
            connection.close()
        assert count == 1
    finally:
        target_path.unlink(missing_ok=True)


def test_session_scope_commits_on_success_and_rolls_back_on_error(
    valid_env: pytest.MonkeyPatch,
) -> None:
    _SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    db_path = _SCRATCH_DIR / f"{uuid.uuid4().hex}-scope.db"
    valid_env.setenv("DATABASE_URL", f"sqlite:///{db_path}")

    try:
        settings = load_settings()
        engine = create_engine(settings)
        Base.metadata.create_all(engine)
        session_factory = create_session_factory(settings)

        def _task(title: str) -> Task:
            return Task(
                title=title,
                content="body",
                status=TaskStatus.TODO,
                category=TaskCategory.WORK,
                priority=TaskPriority.LOW,
                position=0.0,
            )

        # A transaction that raises leaves no partial write behind.
        with pytest.raises(RuntimeError), session_scope(session_factory) as session:
            session.add(_task("never committed"))
            raise RuntimeError("boom")

        # A transaction that completes normally is committed.
        with session_scope(session_factory) as session:
            session.add(_task("committed"))

        with session_factory() as session:
            titles = [task.title for task in session.query(Task).all()]
        assert titles == ["committed"]

        session_factory.kw["bind"].dispose()
        engine.dispose()
    finally:
        db_path.unlink(missing_ok=True)
