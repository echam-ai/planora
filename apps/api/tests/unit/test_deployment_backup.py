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
    assert list(tmp_path.glob("*.dump")) == [existing]


def test_empty_dump_is_failure_and_not_published(tmp_path):
    def empty(args, **kwargs):
        Path(args[-1]).write_bytes(b"")
    with pytest.raises(RuntimeError, match="empty"):
        backup.run_backup(tmp_path, runner=empty)
    assert not list(tmp_path.glob("*.dump"))
    assert not list(tmp_path.glob("*.partial"))


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


def successful_dump(args, **kwargs):
    Path(args[-1]).write_bytes(b"PGDMPtest")


@pytest.mark.parametrize("count", range(10))
def test_rotation_keeps_latest_seven_completion_identities(tmp_path, count):
    results = []
    for day in range(1, count + 1):
        results.append(backup.run_backup(
            tmp_path, runner=successful_dump,
            now=lambda day=day: datetime(2026, 10, day, tzinfo=UTC),
        ))
    assert sorted(tmp_path.glob("*.dump")) == results[-7:]


@pytest.mark.parametrize("failure", [RuntimeError, KeyboardInterrupt])
def test_failure_or_interruption_preserves_all_seven_recovery_points(tmp_path, failure):
    for day in range(1, 8):
        backup.run_backup(tmp_path, runner=successful_dump,
                          now=lambda day=day: datetime(2026, 10, day, tzinfo=UTC))
    before = {p.name: p.read_bytes() for p in tmp_path.glob("*.dump")}
    def fail(args, **kwargs):
        Path(args[-1]).write_bytes(b"partial")
        raise failure()
    with pytest.raises(failure):
        backup.run_backup(tmp_path, runner=fail)
    assert {p.name: p.read_bytes() for p in tmp_path.glob("*.dump")} == before
    assert not list(tmp_path.glob("*.partial"))
    backup.run_backup(tmp_path, runner=successful_dump,
                      now=lambda: datetime(2026, 10, 8, tzinfo=UTC))
    retained = {p.name: p.read_bytes() for p in tmp_path.glob("*.dump")}
    assert len(retained) == 7
    assert min(before) not in retained
    assert all(retained[name] == value for name, value in before.items() if name in retained)


def test_restore_requires_readable_input_and_explicit_separate_target(tmp_path, monkeypatch):
    monkeypatch.setenv("PGDATABASE", "source")
    runner = Mock()
    with pytest.raises(OSError):
        backup.restore_backup(tmp_path / "missing.dump", "restored", runner=runner)
    dump = tmp_path / "valid.dump"
    dump.write_bytes(b"PGDMPtest")
    for target in ("", "source", "dbname=source", " source "):
        with pytest.raises(ValueError):
            backup.restore_backup(dump, target, runner=runner)
    runner.assert_not_called()
    backup.restore_backup(dump, "restored", runner=runner)
    args = runner.call_args.args[0]
    assert "--single-transaction" in args and "--exit-on-error" in args
    assert args[args.index("--dbname") + 1] == "restored"
    assert "--clean" not in args


def test_restore_tool_failure_propagates(tmp_path):
    dump = tmp_path / "truncated.dump"
    dump.write_bytes(b"PGDMP")
    with pytest.raises(subprocess.CalledProcessError):
        backup.restore_backup(dump, "restore45", runner=Mock(
            side_effect=subprocess.CalledProcessError(1, "pg_restore")))


def test_partial_and_unrelated_files_are_ignored_by_retention(tmp_path):
    partial = tmp_path / "abandoned.partial"
    other = tmp_path / "operator.dump"
    partial.write_bytes(b"interrupted")
    other.write_bytes(b"unrelated")
    for day in range(1, 10):
        backup.run_backup(tmp_path, runner=successful_dump,
                          now=lambda day=day: datetime(2026, 10, day, tzinfo=UTC))
    assert partial.read_bytes() == b"interrupted"
    assert other.read_bytes() == b"unrelated"
    assert len([p for p in tmp_path.iterdir() if backup.DUMP_NAME.fullmatch(p.name)]) == 7


def test_failure_before_durable_publication_does_not_rotate(tmp_path, monkeypatch):
    for day in range(1, 8):
        backup.run_backup(tmp_path, runner=successful_dump,
                          now=lambda day=day: datetime(2026, 10, day, tzinfo=UTC))
    before = {p.name: p.read_bytes() for p in tmp_path.glob("*.dump")}
    monkeypatch.setattr(backup.os, "fsync", Mock(side_effect=OSError("storage failure")))
    with pytest.raises(OSError):
        backup.run_backup(tmp_path, runner=successful_dump)
    assert {p.name: p.read_bytes() for p in tmp_path.glob("*.dump")} == before


@pytest.mark.parametrize("arguments", [
    ["--restore", "/backups/file.dump"], ["--database", "restore45"],
])
def test_restore_cli_requires_both_explicit_arguments(monkeypatch, arguments):
    monkeypatch.setattr("sys.argv", ["backup.py", *arguments])
    with pytest.raises(SystemExit) as result:
        backup.main()
    assert result.value.code == 2
