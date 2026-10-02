"""Preserve shared revisions while emitting their intended single checks on PG."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import CheckConstraint, Column, Enum, MetaData, Table, event
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.schema import CreateTable

from planora_api.db.migration_compat import (
    historical_postgresql_checks,
    remove_historical_enum_duplicates,
)


def historical_tables(monkeypatch):
    tables = []
    def capture(name, *items, **kwargs):
        tables.append(Table(name, MetaData(), *items))
    from alembic import op
    monkeypatch.setattr(op, "create_table", capture)
    for filename in ("ef184dd6772f_add_chat_conversation_and_message_tables.py", "ea8f66633290_add_chat_action_table.py"):
        path = Path(__file__).resolve().parents[2] / "alembic" / "versions" / filename
        spec = importlib.util.spec_from_file_location(filename, path)
        revision = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(revision)
        revision.upgrade()
    return tables


@pytest.mark.parametrize("table_name,names", [
    ("chat_message", ("ck_chat_message_role",)),
    ("chat_action", ("ck_chat_action_kind", "ck_chat_action_status")),
])
def test_historical_postgresql_ddl_preserves_one_canonical_check(monkeypatch, table_name, names):
    table = next(t for t in historical_tables(monkeypatch) if t.name == table_name)
    remove_historical_enum_duplicates(table, SimpleNamespace(dialect=postgresql.dialect()))
    sql = str(CreateTable(table).compile(dialect=postgresql.dialect()))
    for name in names:
        assert sql.count(f"CONSTRAINT {name} CHECK") == 1
    assert "'user', 'assistant'" in sql if table_name == "chat_message" else "'pending', 'applied', 'rejected'" in sql


def test_sqlite_ddl_is_unchanged(monkeypatch):
    for table in historical_tables(monkeypatch):
        before = str(CreateTable(table).compile(dialect=sqlite.dialect()))
        remove_historical_enum_duplicates(table, SimpleNamespace(dialect=sqlite.dialect()))
        assert str(CreateTable(table).compile(dialect=sqlite.dialect())) == before


def test_unknown_duplicate_is_not_silently_removed():
    table = Table("future_table", MetaData(), Column("value", Enum("a", "b", native_enum=False, create_constraint=True, name="future_check")), CheckConstraint("value IN ('a', 'b')", name="future_check"))
    remove_historical_enum_duplicates(table, SimpleNamespace(dialect=postgresql.dialect()))
    assert len([c for c in table.constraints if c.name == "future_check"]) == 2


def test_listener_is_removed_when_migration_raises():
    assert not event.contains(Table, "before_create", remove_historical_enum_duplicates)
    with pytest.raises(RuntimeError), historical_postgresql_checks():
        assert event.contains(Table, "before_create", remove_historical_enum_duplicates)
        raise RuntimeError("migration failed")
    assert not event.contains(Table, "before_create", remove_historical_enum_duplicates)
