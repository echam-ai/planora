"""The deployed backup uses one operation for scheduled and smoke runs."""
import importlib.util
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import Mock
from zoneinfo import ZoneInfo

import pytest

path = Path(__file__).resolve().parents[4] / "deploy" / "backup.py"
spec = importlib.util.spec_from_file_location("deployment_backup", path)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


@pytest.mark.parametrize("now,expected", [
    (datetime(2026, 10, 1, 18, tzinfo=UTC), datetime(2026, 10, 1, 19, tzinfo=UTC)),
    (datetime(2026, 10, 1, 19, tzinfo=UTC), datetime(2026, 10, 2, 19, tzinfo=UTC)),
    (datetime(2026, 10, 1, 20, tzinfo=UTC), datetime(2026, 10, 2, 19, tzinfo=UTC)),
])
def test_next_daily_run_is_three_am_in_application_timezone(now, expected):
    assert backup.next_run(now, ZoneInfo("Asia/Singapore")) == expected


def test_schedule_tracks_dst_instead_of_fixed_24_hour_delay():
    now = datetime(2026, 3, 7, 8, tzinfo=UTC)
    assert backup.next_run(now, ZoneInfo("America/New_York")) == datetime(2026, 3, 8, 7, tzinfo=UTC)


def test_dump_is_atomic_custom_format_and_does_not_put_password_in_arguments(tmp_path):
    def dump(args, **kwargs):
        assert args[:3] == ["pg_dump", "--format=custom", "--no-password"]
        assert "private-password" not in repr(args)
        Path(args[-1]).write_bytes(b"PGDMPtest")
    runner = Mock(side_effect=dump)
    result = backup.run_backup(tmp_path, runner=runner)
    assert result.suffix == ".dump"
    assert result.read_bytes() == b"PGDMPtest"
    assert result.stat().st_mode & 0o777 == 0o600
    assert not list(tmp_path.glob("*.partial"))


def test_failed_dump_removes_partial_file_and_preserves_existing_dump(tmp_path):
    existing = tmp_path / "previous.dump"
    existing.write_bytes(b"previous")
    def fail(args, **kwargs):
        Path(args[-1]).write_bytes(b"incomplete")
        raise subprocess.CalledProcessError(1, args)
    with pytest.raises(subprocess.CalledProcessError):
        backup.run_backup(tmp_path, runner=fail)
    assert existing.read_bytes() == b"previous"
    assert list(tmp_path.iterdir()) == [existing]


def test_empty_dump_is_failure_and_not_published(tmp_path):
    def empty(args, **kwargs):
        Path(args[-1]).write_bytes(b"")
    with pytest.raises(RuntimeError, match="empty"):
        backup.run_backup(tmp_path, runner=empty)
    assert not list(tmp_path.iterdir())


def test_worker_stop_interrupts_wait_without_running_backup(tmp_path):
    import threading
    stop = threading.Event()
    operation = Mock()
    worker = backup.BackupWorker(tmp_path, ZoneInfo("Asia/Singapore"), stop, operation=operation)
    stop.set()
    worker.run()
    operation.assert_not_called()


def test_postgresql_driver_is_installed():
    import psycopg
    assert psycopg.__version__
