"""Opt-in actual PostgreSQL recovery smoke; see docs/ops/backup-restore.md.

The caller owns the uniquely named Compose project and its eventual cleanup.
This test creates/drops only its two randomly named disposable databases.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import MetaData, create_engine, select, text
from sqlalchemy.orm import Session

from alembic import command
from planora_api.db.models import (
    AppSettings,
    AppUser,
    ChatAction,
    ChatMessage,
    Conversation,
    Task,
)
from planora_api.security.password import hash_password

ROOT = Path(__file__).resolve().parents[4]
MARKERS = ("issue45-password-marker", "issue45-session-marker",
           "issue45-llm-marker", "issue45-database-marker")


def snapshot(engine):
    metadata = MetaData()
    metadata.reflect(engine)
    with engine.connect() as connection:
        connection.execute(text("SET TIME ZONE 'UTC'"))
        return {
            table.name: [dict(row) for row in connection.execute(
                select(table).order_by(*table.primary_key.columns)).mappings()]
            for table in metadata.sorted_tables
        }


def digest(value):
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True).encode()).hexdigest()


def test_actual_dump_restore_credentials_and_container_persistence(valid_env, alembic_config):
    project = os.environ.get("PLANORA_BACKUP_SMOKE_PROJECT")
    if not project:
        pytest.skip("opt-in: start uniquely named compose.test-backup.yml project")
    assert project.startswith("planora45-"), "Use an explicitly disposable #45 project"
    docker = ["docker"]
    if context := os.environ.get("PLANORA_BACKUP_DOCKER_CONTEXT"):
        docker += ["--context", context]
    compose = docker + ["compose", "-p", project, "-f", str(ROOT / "deploy/compose.test-backup.yml")]

    def run(*args, check=True):
        return subprocess.run(compose + list(args), cwd=ROOT, check=check,
                              capture_output=True, text=True)

    port = os.environ.get("PLANORA_TEST_BACKUP_PORT", "15445")
    url = f"postgresql+psycopg://planora_test45:{MARKERS[3]}@127.0.0.1:{port}/"
    admin = create_engine(url + "planora_test45", isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    identity = uuid.uuid4().hex[:12]
    source, target = f"planora_test45_source_{identity}", f"planora_test45_restore_{identity}"
    engines = []
    try:
        with admin.connect() as connection:
            for name in (source, target):
                connection.execute(text(f'CREATE DATABASE "{name}"'))
        valid_env.setenv("DATABASE_URL", url + source)
        valid_env.setenv("SESSION_SECRET", MARKERS[1])
        valid_env.setenv("LLM_API_KEY", MARKERS[2])
        command.upgrade(alembic_config, "head")
        source_engine = create_engine(url + source)
        restored_engine = create_engine(url + target)
        engines += [source_engine, restored_engine]
        now = datetime(2026, 10, 1, 4, 5, 6, 123456, tzinfo=UTC)
        task_id, archive_id, message_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        password_hash = hash_password(MARKERS[0])
        with Session(source_engine) as session:
            session.add_all([
                AppUser(id=1, username="backup-owner", password_hash=password_hash,
                        created_at=now, updated_at=now),
                AppSettings(id=1, timezone="Asia/Singapore", model_name="kimi-k3", updated_at=now),
                Task(id=task_id, title="Recovery task", content="Preserved", status="in_progress",
                     category="work", priority="high", position=123.5, deadline_at=now,
                     urls=[{"label": "Reference", "url": "https://example.com"}],
                     markdown_note="**note**", created_at=now, updated_at=now),
                Task(id=archive_id, title="Archived", content="History", status="done",
                     category="personal", priority="low", position=456, completed_at=now,
                     archived_at=now, created_at=now, updated_at=now),
                Conversation(id=1, conversation_id=uuid.uuid4(), created_at=now, updated_at=now),
                ChatMessage(id=message_id, sequence=1, role="assistant", text="Move proposal",
                            created_at=now),
                ChatAction(id=uuid.uuid4(), message_id=message_id, task_id=task_id,
                           kind="move", status="pending", title="Move", summary="Review",
                           fields=[], payload={"task_id": str(task_id), "status": "done"},
                           stale_snapshot={"status": "in_progress"}, created_at=now, updated_at=now),
            ])
            session.commit()
        before = snapshot(source_engine)
        assert before["alembic_version"]
        # Normal --once path and nine deterministic actual dumps, same operation
        # used by the scheduler, without waiting nine days.
        run("run", "--rm", "--no-deps", "-e", f"PGDATABASE={source}", "backup", "--once")
        script = (
            "import runpy; from pathlib import Path; from datetime import datetime, UTC; "
            "m=runpy.run_path('/usr/local/bin/planora-backup.py'); "
            "[m['run_backup'](Path('/backups'), now=lambda day=day: "
            "datetime(2030,1,day,tzinfo=UTC)) for day in range(1,10)]"
        )
        run("exec", "-T", "-e", f"PGDATABASE={source}", "backup", "python3", "-c", script)
        inventory = "from pathlib import Path; import hashlib,json; print(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(Path('/backups').glob('*.dump'))}))"
        retained = json.loads(run("exec", "-T", "backup", "python3", "-c", inventory).stdout)
        assert len(retained) == 7
        assert [name[8:16] for name in retained] == [f"203001{day:02d}" for day in range(3, 10)]
        for name in retained:
            run("exec", "-T", "backup", "pg_restore", "--list", "/backups/" + name)
        dump = "/backups/" + max(retained)
        decoded = run("exec", "-T", "backup", "pg_restore", "--file=-", dump).stdout
        assert all(marker not in decoded for marker in MARKERS)
        assert password_hash in decoded
        # Exact documented restore CLI. Explicit target; no --clean or live overwrite.
        run("run", "--rm", "--no-deps", "-e", f"PGDATABASE={source}", "backup",
            "--restore", dump, "--database", target)
        after = snapshot(restored_engine)
        assert after == before
        assert after["chat_action"][0]["message_id"] == after["chat_message"][0]["id"]
        assert after["chat_action"][0]["task_id"] in {r["id"] for r in after["task"]}
        assert all(value.utcoffset().total_seconds() == 0
                   for rows in after.values() for row in rows
                   for value in row.values() if isinstance(value, datetime))
        # Every failed restore is nonzero and transactional; source/dumps unchanged.
        run("exec", "-T", "backup", "sh", "-c", f"head -c 20 '{dump}' > /backups/invalid.partial")
        run("exec", "-T", "backup", "sh", "-c", "printf invalid > /backups/garbage.partial")
        for bad in ("/backups/missing.dump", "/backups/invalid.partial",
                    "/backups/garbage.partial", dump):
            result = run("run", "--rm", "--no-deps", "-e", f"PGDATABASE={source}", "backup",
                         "--restore", bad, "--database", target, check=False)
            assert result.returncode != 0
            assert snapshot(restored_engine) == before
        assert snapshot(source_engine) == before
        for engine in engines:
            engine.dispose()
        run("up", "-d", "--wait", "--force-recreate", "db", "backup")
        assert snapshot(source_engine) == before
        assert snapshot(restored_engine) == before
        assert json.loads(run("exec", "-T", "backup", "python3", "-c", inventory).stdout) == retained
        version = run("exec", "-T", "backup", "pg_restore", "--version").stdout.strip()
        print(f"{version}; 7 retained days 3–9; decoded credential audit PASS")
        print(f"snapshot SHA256={digest(before)}; counts="
              f"{ {name: len(rows) for name, rows in before.items()} }")
        print("restore/source/UTC/relationships/recreation/invalid inputs PASS")
    finally:
        for engine in engines:
            engine.dispose()
        with admin.connect() as connection:
            for name in (target, source):
                connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()
