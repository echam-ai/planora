import pytest
from database_backend import validate_postgres_url
from sqlalchemy.dialects.postgresql.psycopg import PGDialect_psycopg
from sqlalchemy.engine import make_url


@pytest.mark.parametrize("url", [
    "sqlite:///production.db",
    "postgresql+psycopg://user:secret@127.0.0.1/planora",
    "postgresql+psycopg://user:secret@production.example/planora_test",
    "postgresql+psycopg://user:secret@127.0.0.1/planora_test?options=-csearch_path=public",
    "",
])
def test_selector_rejects_unsafe_targets_without_exposing_credentials(url):
    with pytest.raises(ValueError) as error:
        validate_postgres_url(url)
    assert "secret" not in str(error.value)


def test_selector_accepts_explicit_local_test_database():
    url = validate_postgres_url("postgresql+psycopg://user:test-only@127.0.0.1:15444/planora_test44")
    assert url.database == "planora_test44"


@pytest.mark.parametrize("query", [
    "host=production.invalid",
    "hostaddr=192.0.2.1",
    "dbname=production",
    "database=production",
    "service=production",
    "port=5433",
    "user=production",
    "password=secret",
    "options=-csearch_path=public",
    "sslmode=require",
    "connect_timeout=5",
    "application_name=test",
])
def test_selector_rejects_all_external_driver_options(query):
    raw = f"postgresql+psycopg://user:secret@127.0.0.1:15444/planora_test44?{query}"
    with pytest.raises(ValueError) as error:
        validate_postgres_url(raw)
    assert "secret" not in str(error.value)


def test_host_override_changes_real_driver_target_but_selector_rejects_it():
    raw = "postgresql+psycopg://user:secret@127.0.0.1/planora_test44?host=production.invalid"
    _, effective = PGDialect_psycopg().create_connect_args(make_url(raw))
    assert effective["host"] == "production.invalid"
    with pytest.raises(ValueError):
        validate_postgres_url(raw)


def test_encoded_credentials_and_port_reach_driver_without_target_overrides():
    url = validate_postgres_url(
        "postgresql+psycopg://test%40user:fake%3Apass%40word@127.0.0.1:15444/planora_test44"
    )
    _, effective = PGDialect_psycopg().create_connect_args(url)
    assert effective == {
        "host": "127.0.0.1",
        "port": 15444,
        "dbname": "planora_test44",
        "user": "test@user",
        "password": "fake:pass@word",
    }
