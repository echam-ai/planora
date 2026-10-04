"""Integration tests for `python -m planora_api.jobs.archive_done_tasks`
(issue #32) — the run-once command's exit codes and logging.

`main(argv)` is invoked in-process (never `subprocess`) and returns an
`int`, per its own docstring — these tests assert that return value
directly rather than catching `SystemExit`.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from conftest import VALID_ENV
from sqlalchemy.orm import Session, sessionmaker

from planora_api.db.models import Task, TaskCategory, TaskPriority, TaskStatus
from planora_api.jobs.archive_done_tasks import main

SEVEN_DAYS = timedelta(days=7)


def _seed_task(
    session_factory: sessionmaker[Session], **overrides: Any
) -> uuid.UUID:
    defaults: dict[str, Any] = {
        "title": "Task",
        "content": "Content",
        "status": TaskStatus.TODO,
        "category": TaskCategory.WORK,
        "priority": TaskPriority.MEDIUM,
        "position": 1.0,
    }
    defaults.update(overrides)
    with session_factory() as session:
        task = Task(**defaults)
        session.add(task)
        session.commit()
        return task.id


def test_exit_0_with_one_eligible_task_archives_it_and_logs_completion(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    task_id = _seed_task(
        migrated_session_factory,
        status=TaskStatus.DONE,
        completed_at=datetime.now(UTC) - SEVEN_DAYS - timedelta(hours=1),
    )
    caplog.set_level(logging.INFO, logger="planora_api.jobs.archive_done_tasks")

    code = main([])

    assert code == 0
    with migrated_session_factory() as session:
        task = session.get(Task, task_id)
        assert task is not None
        assert task.archived_at is not None
    completed = [r for r in caplog.records if r.message == "archive_job_completed"]
    assert len(completed) == 1
    assert completed[0].archived_count == 1


def test_exit_0_when_zero_tasks_are_eligible(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
) -> None:
    _seed_task(migrated_session_factory, status=TaskStatus.TODO)
    assert main([]) == 0


def test_exit_1_when_the_task_table_is_missing(
    database_url: str,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # An empty selected-backend database with no migrations applied — the `task`
    # table simply doesn't exist, so the run itself fails.
    caplog.set_level(logging.ERROR, logger="planora_api.jobs.archive_done_tasks")

    code = main([])
    assert code == 1
    failed = [r for r in caplog.records if r.message == "archive_job_failed"]
    assert len(failed) == 1
    assert failed[0].error_type
    captured = capsys.readouterr()
    assert "Traceback" not in captured.out
    assert "Traceback" not in captured.err


def test_exit_2_with_message_naming_the_variable_on_invalid_configuration(
    clean_env: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    for name, value in VALID_ENV.items():
        if name != "LLM_API_KEY":
            clean_env.setenv(name, value)
    # SESSION_SECRET deliberately left unset.

    code = main([])

    assert code == 2
    captured = capsys.readouterr()
    assert "LLM_API_KEY" in captured.err


@pytest.mark.parametrize("name", ["APP_PASSWORD", "SESSION_SECRET"])
@pytest.mark.parametrize("value", [None, "   ", "short"])
def test_exit_2_naming_a_missing_or_short_gate_secret(
    valid_env: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    name: str,
    value: str | None,
) -> None:
    if value is None:
        valid_env.delenv(name)
    else:
        valid_env.setenv(name, value)

    assert main([]) == 2

    captured = capsys.readouterr()
    assert name in captured.err
    assert "short" not in captured.err


def test_exit_2_for_an_unrecognized_argument(
    valid_env: pytest.MonkeyPatch,
) -> None:
    assert main(["--not-a-real-flag"]) == 2


def test_no_response_or_log_contains_a_configured_secret_value(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # Only the two secret variables are overridden — `migrated_session_
    # factory` already pointed DATABASE_URL at a real, migrated temp
    # database via `valid_env`; resetting it here would break that.
    sentinels = {
        "SESSION_SECRET": "SENTINEL-session-secret-value-0123456789",
        "APP_PASSWORD": "SENTINEL-app-password-value",
        "LLM_API_KEY": "SENTINEL-llm-api-key-value",
    }
    for name, value in sentinels.items():
        valid_env.setenv(name, value)
    caplog.set_level(logging.DEBUG)

    main([])

    captured = capsys.readouterr()
    for value in sentinels.values():
        assert value not in captured.out
        assert value not in captured.err
    for record in caplog.records:
        for value in sentinels.values():
            assert value not in record.getMessage()
