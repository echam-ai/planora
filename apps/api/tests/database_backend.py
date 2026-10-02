"""Disposable test targets only; never inherit an application's DATABASE_URL."""
import uuid
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.pool import NullPool
from sqlalchemy.schema import CreateSchema, DropSchema


def validate_postgres_url(raw):
    try:
        url = make_url(raw)
    except ArgumentError:
        raise ValueError("Set PLANORA_TEST_POSTGRES_URL to an explicit disposable PostgreSQL URL") from None
    if (
        url.drivername != "postgresql+psycopg"
        or url.host not in {"127.0.0.1", "localhost", "::1", "db", "postgres"}
        or not (url.database or "").startswith("planora_test")
        or bool(url.query)
    ):
        raise ValueError("PostgreSQL tests require a local postgresql+psycopg target named planora_test* without query parameters")
    return url


@contextmanager
def isolated_database(backend, postgres_url, scratch: Path):
    if backend == "sqlite":
        scratch.mkdir(parents=True, exist_ok=True)
        path = scratch / f"{uuid.uuid4().hex}.db"
        try:
            yield f"sqlite:///{path}"
        finally:
            path.unlink(missing_ok=True)
        return
    base = validate_postgres_url(postgres_url)
    schema = f"planora_test_{uuid.uuid4().hex}"
    engine = create_engine(base, poolclass=NullPool)
    try:
        with engine.begin() as connection:
            connection.execute(CreateSchema(schema))
        selected = base.update_query_dict({"options": f"-csearch_path={schema}"})
        try:
            yield selected.render_as_string(hide_password=False)
        finally:
            with engine.begin() as connection:
                connection.execute(DropSchema(schema, cascade=True))
    finally:
        engine.dispose()
