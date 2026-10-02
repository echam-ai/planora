"""Integration tests for `python -m planora_api.admin.reset_password`
(issue #33, spec §3.2).

`main(argv, ...)` is invoked in-process (never `subprocess`) with
`prompt`/`read_line`/`stdin_is_tty` injected, against the migrated-database
fixtures from `conftest.py` — the same pattern `tests/integration/
test_archive_job_command.py` (#32) uses for its own run-once command.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import AUTH_PASSWORD, AUTH_USERNAME, VALID_ENV, make_client
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from planora_api.admin.reset_password import main
from planora_api.config import load_settings
from planora_api.db.models import AppUser, AuthSession, LoginFailure
from planora_api.security.password import verify_password
from planora_api.security.session import create_session

NEW_PASSWORD = "new-password"


def _scripted(*answers: str) -> Callable[[str], str]:
    """A `prompt`/`read_line` stand-in that returns each answer in order,
    raising `EOFError` once exhausted — matching what a real EOF looks
    like to `getpass.getpass`/`input`, so a test that supplies too few
    answers fails the way a real interrupted session would rather than
    hanging or raising `StopIteration`."""
    values = iter(answers)

    def _read(_prompt_text: str) -> str:
        try:
            return next(values)
        except StopIteration:
            raise EOFError from None

    return _read


def _get_user(session_factory: sessionmaker[Session]) -> AppUser:
    with session_factory() as session:
        user = session.get(AppUser, 1)
        assert user is not None
        return user


def _session_count(session_factory: sessionmaker[Session]) -> int:
    with session_factory() as session:
        return len(list(session.execute(select(AuthSession)).scalars().all()))


def _failure_count(session_factory: sessionmaker[Session]) -> int:
    with session_factory() as session:
        return len(list(session.execute(select(LoginFailure)).scalars().all()))


def _seed_two_sessions(session_factory: sessionmaker[Session], secret: str) -> list[str]:
    tokens = []
    with session_factory() as session:
        for _ in range(2):
            token, _row = create_session(session, secret, datetime.now(UTC))
            tokens.append(token)
        session.commit()
    return tokens


def _seed_login_failures(session_factory: sessionmaker[Session], count: int) -> None:
    now = datetime.now(UTC)
    with session_factory() as session:
        for i in range(count):
            session.add(LoginFailure(client_ip="203.0.113.9", failed_at=now - timedelta(seconds=i)))
        session.commit()


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _login(client: AsyncClient, password: str) -> Response:
    return await client.post(
        "/api/v1/auth/login", json={"username": AUTH_USERNAME, "password": password}
    )


# --- Scenario: Owner resets a forgotten password ----------------------------


def test_reset_replaces_hash_clears_sessions_and_failures_and_reports_the_username(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    settings = load_settings()
    tokens = _seed_two_sessions(migrated_session_factory, settings.session_secret)
    _seed_login_failures(migrated_session_factory, 5)
    user_before = _get_user(migrated_session_factory)

    code = main(
        [], prompt=_scripted(NEW_PASSWORD, NEW_PASSWORD), read_line=_scripted(), stdin_is_tty=lambda: True
    )

    assert code == 0
    user_after = _get_user(migrated_session_factory)
    assert user_after.password_hash.startswith("$argon2id$")
    assert user_after.password_hash != user_before.password_hash
    assert verify_password(user_after.password_hash, NEW_PASSWORD)
    assert user_after.username == AUTH_USERNAME
    assert user_after.created_at == user_before.created_at
    assert user_after.updated_at != user_before.updated_at

    assert _session_count(migrated_session_factory) == 0
    assert _failure_count(migrated_session_factory) == 0

    captured = capsys.readouterr()
    assert AUTH_USERNAME in captured.out
    assert NEW_PASSWORD not in captured.out

    # Login with the new password succeeds; the old one fails; both
    # pre-reset session cookies are now rejected.
    app = app_factory()

    async def scenario() -> tuple[Response, Response, Response, Response]:
        async with make_client(app) as client:
            new_login = await _login(client, NEW_PASSWORD)
            old_login = await _login(client, AUTH_PASSWORD)
            checks = []
            for token in tokens:
                client.cookies.set("planora_session", token)
                checks.append(await client.get("/api/v1/auth/session"))
            return new_login, old_login, *checks

    new_login, old_login, check_a, check_b = _run(scenario)
    assert new_login.status_code == 200
    assert old_login.status_code == 401
    assert old_login.json()["code"] == "INVALID_CREDENTIALS"
    assert check_a.json() is None
    assert check_b.json() is None


# --- Scenario: Owner mistypes the confirmation ------------------------------


def test_a_mismatched_confirmation_reprompts_and_still_succeeds(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    capsys: pytest.CaptureFixture[str],
) -> None:
    code = main(
        [],
        prompt=_scripted(NEW_PASSWORD, "new-passwrod", NEW_PASSWORD, NEW_PASSWORD),
        read_line=_scripted(),
        stdin_is_tty=lambda: True,
    )

    assert code == 0
    captured = capsys.readouterr()
    assert captured.err.count("Passwords do not match.") == 1


# --- Scenario: Owner gives up after three bad attempts ----------------------


def test_three_bad_attempts_exits_1_and_changes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
) -> None:
    settings = load_settings()
    _seed_two_sessions(migrated_session_factory, settings.session_secret)
    _seed_login_failures(migrated_session_factory, 3)
    user_before = _get_user(migrated_session_factory)

    code = main(
        [], prompt=_scripted("ab", "cd", "ef"), read_line=_scripted(), stdin_is_tty=lambda: True
    )

    assert code == 1
    user_after = _get_user(migrated_session_factory)
    assert user_after.password_hash == user_before.password_hash
    assert user_after.updated_at == user_before.updated_at
    assert _session_count(migrated_session_factory) == 2
    assert _failure_count(migrated_session_factory) == 3


# --- Scenario: Password is piped in (non-TTY) -------------------------------


def test_non_tty_stdin_exits_2_before_prompting_and_changes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
) -> None:
    user_before = _get_user(migrated_session_factory)

    def _never_called(_prompt_text: str) -> str:
        raise AssertionError("must not prompt when stdin is not a TTY")

    code = main([], prompt=_never_called, read_line=_never_called, stdin_is_tty=lambda: False)

    assert code == 2
    user_after = _get_user(migrated_session_factory)
    assert user_after.password_hash == user_before.password_hash


# --- Scenario: Owner creates the account on first run -----------------------


def test_first_run_with_no_account_prompts_for_username_and_creates_it(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
    capsys: pytest.CaptureFixture[str],
) -> None:
    with migrated_session_factory() as session:
        assert session.get(AppUser, 1) is None

    code = main(
        [],
        prompt=_scripted("first-password", "first-password"),
        read_line=_scripted("owner"),
        stdin_is_tty=lambda: True,
    )

    assert code == 0
    captured = capsys.readouterr()
    assert "created" in captured.out
    assert "owner" in captured.out
    assert "first-password" not in captured.out

    user = _get_user(migrated_session_factory)
    assert user.username == "owner"

    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            return await client.post(
                "/api/v1/auth/login", json={"username": "owner", "password": "first-password"}
            )

    response = _run(scenario)
    assert response.status_code == 200


def test_username_is_trimmed_but_keeps_its_case(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
) -> None:
    code = main(
        [],
        prompt=_scripted("first-password", "first-password"),
        read_line=_scripted("  OwnerName  "),
        stdin_is_tty=lambda: True,
    )
    assert code == 0
    user = _get_user(migrated_session_factory)
    assert user.username == "OwnerName"


def test_invalid_username_reprompts_within_the_shared_attempt_budget(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
) -> None:
    code = main(
        [],
        prompt=_scripted("first-password", "first-password"),
        read_line=_scripted("", "owner"),
        stdin_is_tty=lambda: True,
    )
    assert code == 0
    user = _get_user(migrated_session_factory)
    assert user.username == "owner"


def test_with_an_account_present_the_command_never_prompts_for_a_username(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
) -> None:
    def _never_called(_prompt_text: str) -> str:
        raise AssertionError("read_line must not be called when an account already exists")

    code = main(
        [],
        prompt=_scripted(NEW_PASSWORD, NEW_PASSWORD),
        read_line=_never_called,
        stdin_is_tty=lambda: True,
    )
    assert code == 0
    user = _get_user(migrated_session_factory)
    assert user.username == AUTH_USERNAME


# --- Scenario: Database was never migrated ----------------------------------


def test_unmigrated_database_exits_1_before_any_prompt(
    database_url: str,
) -> None:

    def _never_called(_prompt_text: str) -> str:
        raise AssertionError("must not prompt against an unmigrated database")

    code = main([], prompt=_never_called, read_line=_never_called, stdin_is_tty=lambda: True)
    assert code == 1


# --- Failure modes: configuration, unrecognized argument, database error ----


def test_exit_2_with_message_naming_the_variable_on_invalid_configuration(
    clean_env: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    for name, value in VALID_ENV.items():
        if name != "SESSION_SECRET":
            clean_env.setenv(name, value)

    code = main([], prompt=lambda _p: "unused", read_line=lambda _p: "unused", stdin_is_tty=lambda: True)

    assert code == 2
    captured = capsys.readouterr()
    assert "SESSION_SECRET" in captured.err


def test_exit_2_for_an_unrecognized_argument(valid_env: pytest.MonkeyPatch) -> None:
    assert main(["--not-a-real-flag"], stdin_is_tty=lambda: True) == 2


def test_any_other_database_error_exits_1_and_changes_nothing_atomically(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import OperationalError

    import planora_api.admin.reset_password as reset_password_module

    settings = load_settings()
    _seed_two_sessions(migrated_session_factory, settings.session_secret)
    _seed_login_failures(migrated_session_factory, 2)
    user_before = _get_user(migrated_session_factory)

    def failing_delete_all_sessions(_db: Session) -> None:
        # Fails *after* the hash update already executed within the same
        # transaction — proving the whole thing rolls back together. A
        # real `SQLAlchemyError` subtype, matching what `main` actually
        # catches for "any other database error" (a plain `RuntimeError`
        # deliberately would not be caught by that handler, and
        # shouldn't be — it isn't a database error).
        raise OperationalError("simulated statement", {}, RuntimeError("simulated database failure"))

    monkeypatch.setattr(
        reset_password_module.session_security, "delete_all_sessions", failing_delete_all_sessions
    )

    code = main(
        [], prompt=_scripted(NEW_PASSWORD, NEW_PASSWORD), read_line=_scripted(), stdin_is_tty=lambda: True
    )

    assert code == 1
    user_after = _get_user(migrated_session_factory)
    assert user_after.password_hash == user_before.password_hash
    assert _session_count(migrated_session_factory) == 2
    assert _failure_count(migrated_session_factory) == 2


def test_a_database_error_during_the_migration_check_exits_1_before_any_prompt(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import OperationalError

    import planora_api.admin.reset_password as reset_password_module

    def failing_inspect(_engine: object) -> object:
        raise OperationalError("simulated statement", {}, RuntimeError("connection refused"))

    monkeypatch.setattr(reset_password_module, "sa_inspect", failing_inspect)

    def _never_called(_prompt_text: str) -> str:
        raise AssertionError("must not prompt when the migration check itself fails")

    code = main([], prompt=_never_called, read_line=_never_called, stdin_is_tty=lambda: True)

    assert code == 1


def test_a_database_error_while_reading_the_existing_user_exits_1_before_any_prompt(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy.exc import OperationalError

    import planora_api.admin.reset_password as reset_password_module

    def failing_get_app_user(_db: Session) -> None:
        raise OperationalError("simulated statement", {}, RuntimeError("connection lost"))

    monkeypatch.setattr(reset_password_module.auth_repository, "get_app_user", failing_get_app_user)

    def _never_called(_prompt_text: str) -> str:
        raise AssertionError("must not prompt when reading the existing user fails")

    code = main([], prompt=_never_called, read_line=_never_called, stdin_is_tty=lambda: True)

    assert code == 1


# --- EOF / Ctrl-C ------------------------------------------------------------


def test_eof_at_a_prompt_exits_130_and_changes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
) -> None:
    user_before = _get_user(migrated_session_factory)

    code = main([], prompt=_scripted(), read_line=_scripted(), stdin_is_tty=lambda: True)

    assert code == 130
    user_after = _get_user(migrated_session_factory)
    assert user_after.password_hash == user_before.password_hash


def test_keyboard_interrupt_at_a_prompt_exits_130_and_changes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
) -> None:
    user_before = _get_user(migrated_session_factory)

    def _interrupting_prompt(_prompt_text: str) -> str:
        raise KeyboardInterrupt

    code = main([], prompt=_interrupting_prompt, read_line=_scripted(), stdin_is_tty=lambda: True)

    assert code == 130
    user_after = _get_user(migrated_session_factory)
    assert user_after.password_hash == user_before.password_hash


# --- Secrecy -----------------------------------------------------------------


def test_the_password_and_its_hash_never_leak_on_success_mismatch_or_short_attempt(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    sentinel = "S3ntinel-pw-33"
    valid_env.setenv("LOG_LEVEL", "DEBUG")
    caplog.set_level(logging.DEBUG)

    # Successful run.
    code = main([], prompt=_scripted(sentinel, sentinel), read_line=_scripted(), stdin_is_tty=lambda: True)
    assert code == 0

    # Mismatch, then a too-short attempt, then give up (3rd bad attempt).
    code = main(
        [],
        prompt=_scripted(sentinel, sentinel + "-x", "ab", "cd"),
        read_line=_scripted(),
        stdin_is_tty=lambda: True,
    )
    assert code in (0, 1)  # either outcome is fine; only leakage is checked

    captured = capsys.readouterr()
    for stream in (captured.out, captured.err):
        assert sentinel not in stream
        assert "$argon2id$" not in stream
    for record in caplog.records:
        message = record.getMessage()
        assert sentinel not in message
        assert "$argon2id$" not in message
        for value in vars(record).values():
            assert sentinel not in str(value)
            assert "$argon2id$" not in str(value)


# --- Logging -------------------------------------------------------------


def test_success_emits_a_password_reset_completed_record_with_username_only(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="planora_api.admin.reset_password")

    code = main(
        [], prompt=_scripted(NEW_PASSWORD, NEW_PASSWORD), read_line=_scripted(), stdin_is_tty=lambda: True
    )

    assert code == 0
    completed = [r for r in caplog.records if r.message == "password_reset_completed"]
    assert len(completed) == 1
    assert completed[0].username == AUTH_USERNAME
    assert completed[0].account_created is False
