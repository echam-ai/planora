"""Engine and session factory, built from `Settings.database_url`.

`Settings.database_url` (see `planora_api/config.py`, fixed by #21) is the
only place that names the database. Nothing here reads `DATABASE_URL` or any
other environment variable directly, and nothing hard-codes a URL.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine
from sqlalchemy import create_engine as _sa_create_engine
from sqlalchemy.orm import Session, sessionmaker

from planora_api.config import Settings


def create_engine(settings: Settings) -> Engine:
    """Build the SQLAlchemy engine for `settings.database_url`."""
    return _sa_create_engine(settings.database_url)


def create_session_factory(settings: Settings) -> sessionmaker[Session]:
    """Build a session factory bound to an engine for `settings.database_url`."""
    engine = create_engine(settings)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=True)


@contextmanager
def session_scope(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    """Yield a session, committing on success and rolling back on error.

    Keeps mutations transactional: a caller that raises inside the `with`
    block leaves no partial write behind.
    """
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
