"""The administrative password-reset / first-run account-creation command
(spec §3.2, §17 criterion 1, §19.2, issue #33).

Run directly on the VPS — `docker compose -f deploy/compose.yml exec api
python -m planora_api.admin.reset_password`, never with `-T` — or locally
with `uv run python -m planora_api.admin.reset_password` from `apps/api`.
See `docs/ops/password-reset.md` for the full operator walkthrough. Never
through the HTTP API (issue #26's grooming note: it has no browser
`Origin` to present, and #26's CSRF middleware would reject it); it calls
`db.auth_repository.upsert_app_user`, `security.password.hash_password`
and the security layer's session/failure-clearing functions directly.

**First-run account creation** (orchestrator decision on issue #33,
approved extension of the original scope): #25 creates the `app_user`
table but never a row in it, so nothing can sign in until something does.
With no existing account, this command also prompts for a username and
creates the single row — nothing else in v1 does, and spec acceptance
criterion 1 needs one to exist. With an account already present, the
username is never prompted for or changed; only the password is reset.

**One transaction.** The hash update, every session's deletion and every
login-failure row's deletion happen inside one `db.session.session_scope`
block — all-or-nothing, so a failure partway through (a database error
after the hash update, say) leaves the old hash, the sessions and the
failure rows exactly as they were.
"""

from __future__ import annotations

import argparse
import getpass
import logging
import sys
from collections.abc import Callable, Sequence
from datetime import UTC, datetime

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.exc import SQLAlchemyError

from planora_api.config import ConfigurationError, load_settings
from planora_api.db import auth_repository
from planora_api.db.session import create_session_factory, session_scope
from planora_api.logging import configure_logging
from planora_api.security import password as password_security
from planora_api.security import rate_limit
from planora_api.security import session as session_security

logger = logging.getLogger("planora_api.admin.reset_password")

# Shared across username and password prompts (issue #33's acceptance
# criteria: an invalid username re-prompts "within the same 3-attempt
# limit" the password mismatch/rule-violation loop already uses).
_MAX_ATTEMPTS = 3

_MIN_USERNAME_LENGTH = 1
_MAX_USERNAME_LENGTH = 150

_NON_TTY_MESSAGE = (
    "This command must be run interactively "
    "(e.g. `docker compose exec` without `-T`)."
)
_UNMIGRATED_MESSAGE = "The database has not been migrated. Run `alembic upgrade head` first."
_DB_ERROR_MESSAGE = "A database error occurred. Nothing was changed."
_MISMATCH_MESSAGE = "Passwords do not match."
_USERNAME_RULE_MESSAGE = "Username must be 1 to 150 characters with no control characters."
_TOO_MANY_ATTEMPTS_MESSAGE = "Too many failed attempts. Nothing was changed."

Prompt = Callable[[str], str]
ReadLine = Callable[[str], str]
StdinIsTty = Callable[[], bool]


def _has_control_character(value: str) -> bool:
    return any(ord(char) < 0x20 or ord(char) == 0x7F for char in value)


def _username_is_valid(value: str) -> bool:
    return (
        _MIN_USERNAME_LENGTH <= len(value) <= _MAX_USERNAME_LENGTH
        and not _has_control_character(value)
    )


def _collect_credentials(
    read_line: ReadLine,
    prompt: Prompt,
    existing_username: str | None,
) -> tuple[str, str] | None:
    """Run the interactive prompts and return `(username, new_password)` on
    success, or `None` once the shared 3-attempt budget is exhausted.

    `existing_username` is `None` only on first run (no `app_user` row
    yet) — that is the only case a username is ever prompted for; once
    set (whether supplied here or freshly typed), it never changes for
    the rest of this call. `EOFError`/`KeyboardInterrupt` from `read_line`
    or `prompt` are not caught here — they propagate to `main`, which
    turns either into exit code `130`.
    """
    attempts_left = _MAX_ATTEMPTS
    username = existing_username

    while attempts_left > 0:
        if username is None:
            candidate = read_line("Username: ").strip()
            if not _username_is_valid(candidate):
                print(_USERNAME_RULE_MESSAGE, file=sys.stderr)
                attempts_left -= 1
                continue
            username = candidate

        first = prompt("New password: ")
        if not password_security.password_length_is_valid(first):
            print(password_security.PASSWORD_LENGTH_RULE_MESSAGE, file=sys.stderr)
            attempts_left -= 1
            continue

        second = prompt("Confirm new password: ")
        if first != second:
            print(_MISMATCH_MESSAGE, file=sys.stderr)
            attempts_left -= 1
            continue

        return username, first

    return None


# --- Command ------------------------------------------------------------


def _build_arg_parser() -> argparse.ArgumentParser:
    return argparse.ArgumentParser(
        prog="python -m planora_api.admin.reset_password",
        description=(
            "Reset the single account's password, prompting interactively. "
            "With no account yet, also creates it."
        ),
    )


def main(
    argv: Sequence[str] | None = None,
    *,
    prompt: Prompt = getpass.getpass,
    read_line: ReadLine = input,
    stdin_is_tty: StdinIsTty = sys.stdin.isatty,
) -> int:
    """Run the command once and return an exit code:

    - `0` success (reset or first-run creation).
    - `1` the run failed — an unmigrated database, any other database
      error, or the shared attempt budget was exhausted.
    - `2` invalid configuration, an unrecognized argument, or non-TTY
      stdin.
    - `130` Ctrl-C or EOF at any prompt.

    `prompt`, `read_line` and `stdin_is_tty` are injectable so a test can
    script answers and simulate the TTY flag with no real terminal;
    `main(argv, ...)` is called in-process, never through `subprocess`.
    """
    parser = _build_arg_parser()
    try:
        parser.parse_args(argv)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2

    if not stdin_is_tty():
        print(_NON_TTY_MESSAGE, file=sys.stderr)
        return 2

    try:
        settings = load_settings()
    except ConfigurationError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    configure_logging(
        level=settings.log_level,
        secrets=(settings.session_secret, settings.llm_api_key, settings.database_url),
    )

    session_factory = create_session_factory(settings)
    engine = session_factory.kw["bind"]
    try:
        try:
            table_exists = sa_inspect(engine).has_table("app_user")
        except SQLAlchemyError as exc:
            _log_failure(exc)
            print(_DB_ERROR_MESSAGE, file=sys.stderr)
            return 1

        if not table_exists:
            print(_UNMIGRATED_MESSAGE, file=sys.stderr)
            return 1

        try:
            with session_factory() as read_session:
                existing_user = auth_repository.get_app_user(read_session)
                existing_username = existing_user.username if existing_user is not None else None
        except SQLAlchemyError as exc:
            _log_failure(exc)
            print(_DB_ERROR_MESSAGE, file=sys.stderr)
            return 1

        try:
            credentials = _collect_credentials(read_line, prompt, existing_username)
        except (EOFError, KeyboardInterrupt):
            return 130

        if credentials is None:
            print(_TOO_MANY_ATTEMPTS_MESSAGE, file=sys.stderr)
            return 1

        username, new_password = credentials
        created = existing_username is None
        now = datetime.now(UTC)
        try:
            with session_scope(session_factory) as session:
                auth_repository.upsert_app_user(
                    session,
                    username=username,
                    password_hash=password_security.hash_password(new_password),
                    now=now,
                )
                session_security.delete_all_sessions(session)
                rate_limit.clear_all_login_failures(session)
        except SQLAlchemyError as exc:
            _log_failure(exc)
            print(_DB_ERROR_MESSAGE, file=sys.stderr)
            return 1
    finally:
        engine.dispose()

    if created:
        print(f'Account "{username}" created. All sessions have been signed out.')
    else:
        print(f'Password reset for "{username}". All sessions have been signed out.')

    logger.info(
        "password_reset_completed",
        extra={"username": username, "account_created": created},
    )
    return 0


def _log_failure(exc: Exception) -> None:
    # Never the traceback: it could carry a value from a DATABASE_URL
    # query string or another operator-supplied detail. Only the
    # exception's type.
    logger.error("password_reset_failed", extra={"error_type": type(exc).__name__})


if __name__ == "__main__":  # pragma: no cover - process bootstrap, not importable
    sys.exit(main())
