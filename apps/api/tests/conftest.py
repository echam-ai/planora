"""Shared fixtures for the API test suite.

Database fixtures live here, not in a nested `tests/integration/conftest.py`
— pytest resolves the bare `import conftest` used elsewhere in this suite by
module name, and a second file also named `conftest.py` would collide with
it and break those imports. One conftest, at `tests/`.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi import FastAPI
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from planora_api.config import load_settings
from planora_api.db.session import create_session_factory
from planora_api.main import create_app

# The seven variable names fixed by #21; #22, #25, #26, #37 and #43 rely on
# these exact names.
ENV_VAR_NAMES: tuple[str, ...] = (
    "DATABASE_URL",
    "SESSION_SECRET",
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_MODEL",
    "APP_ORIGIN",
    "DEFAULT_TIMEZONE",
)

# A complete, valid configuration a test can start from and selectively
# override or unset.
VALID_ENV: dict[str, str] = {
    "DATABASE_URL": "sqlite:///./test.db",
    "SESSION_SECRET": "test-session-secret",
    "LLM_BASE_URL": "https://llm.example.com/v1",
    "LLM_API_KEY": "test-llm-api-key",
    "LLM_MODEL": "test-model",
    "APP_ORIGIN": "https://planora.example",
    "DEFAULT_TIMEZONE": "Europe/Paris",
}


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Remove all seven configuration variables from the environment.

    Prevents a developer's real shell environment from leaking into a test
    that wants to control every value explicitly.
    """
    for name in ENV_VAR_NAMES:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


@pytest.fixture
def valid_env(clean_env: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    """Set all seven configuration variables to valid values."""
    for name, value in VALID_ENV.items():
        clean_env.setenv(name, value)
    yield clean_env


# --- Database fixtures (#22) ------------------------------------------------
#
# Every scratch database lives under the repository's `.tmp/`, never `/tmp`
# (binding rule 10) — deliberately not pytest's `tmp_path`. `valid_env` first
# clears all seven configuration variables from the real shell, so these
# fixtures never touch the developer's `./planora.db` or a stray
# `DATABASE_URL` left in the environment.

# tests/conftest.py -> tests -> apps/api
_API_ROOT = Path(__file__).resolve().parents[1]
# apps/api -> repo root
_REPO_ROOT = _API_ROOT.parents[1]
_DB_SCRATCH_DIR = _REPO_ROOT / ".tmp" / "issue-22-db-tests"


@pytest.fixture
def alembic_config() -> Config:
    """An Alembic `Config` for this project.

    No `sqlalchemy.url` is set here — `alembic/env.py` ignores it and reads
    `Settings.database_url` (via `load_settings()`) on every invocation, so
    a test points this at a different database purely by changing
    `DATABASE_URL` in the environment before calling `command.upgrade`/
    `command.downgrade` with this config.
    """
    config = Config(str(_API_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(_API_ROOT / "alembic"))
    return config


@pytest.fixture
def migrated_db_path(
    valid_env: pytest.MonkeyPatch, alembic_config: Config
) -> Iterator[Path]:
    """A fresh SQLite file under the repo's `.tmp/`, migrated to `head`
    through Alembic (not `metadata.create_all`)."""
    _DB_SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    db_path = _DB_SCRATCH_DIR / f"{uuid.uuid4().hex}.db"
    valid_env.setenv("DATABASE_URL", f"sqlite:///{db_path}")

    command.upgrade(alembic_config, "head")

    try:
        yield db_path
    finally:
        db_path.unlink(missing_ok=True)


@pytest.fixture
def migrated_session_factory(
    migrated_db_path: Path,
) -> Iterator[sessionmaker[Session]]:
    """A session factory bound to the freshly migrated database above."""
    settings = load_settings()
    session_factory = create_session_factory(settings)
    try:
        yield session_factory
    finally:
        # `create_session_factory` builds its own engine; dispose it here so
        # the test run doesn't leak pooled SQLite connections.
        session_factory.kw["bind"].dispose()


# --- Auth fixtures (#25) -----------------------------------------------------

AUTH_USERNAME = "owner"
AUTH_PASSWORD = "correct horse battery staple"


def seed_app_user(
    session_factory: sessionmaker[Session],
    *,
    username: str = AUTH_USERNAME,
    password: str = AUTH_PASSWORD,
    now: object | None = None,
) -> None:
    """Create the single `app_user` row directly through the repository
    function #25 provides for #33, so auth tests don't need a real signup
    endpoint (there isn't one — #25 creates no user, see the issue)."""
    from datetime import UTC, datetime

    from planora_api.db import auth_repository
    from planora_api.security.password import hash_password

    if now is None:
        now = datetime.now(UTC)
    with session_factory() as session:
        auth_repository.upsert_app_user(
            session, username=username, password_hash=hash_password(password), now=now
        )
        session.commit()


@pytest.fixture
def seeded_user(
    migrated_session_factory: sessionmaker[Session],
) -> tuple[str, str]:
    """The single account, seeded with `AUTH_USERNAME`/`AUTH_PASSWORD`."""
    seed_app_user(migrated_session_factory)
    return AUTH_USERNAME, AUTH_PASSWORD


@pytest.fixture
def app_factory() -> Iterator[Callable[[], FastAPI]]:
    """A `create_app()` wrapper that disposes each built app's database
    engine at teardown.

    `create_app()` builds its own SQLAlchemy engine per call (via
    `db.session.create_session_factory`), and nothing else disposes it —
    unlike `migrated_session_factory` above, which explicitly disposes in
    its own teardown. The auth integration tests call `create_app()` many
    times each; without this, every pooled sqlite3 connection is only
    closed whenever the garbage collector happens to run, which pytest
    reports as a `ResourceWarning: unclosed database`.
    """
    built_apps: list[FastAPI] = []

    def make_app() -> FastAPI:
        app = create_app()
        built_apps.append(app)
        return app

    yield make_app

    for app in built_apps:
        app.state.session_factory.kw["bind"].dispose()
