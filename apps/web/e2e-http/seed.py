"""Deterministic seeding for the HTTP-mode smoke suite (#88).

Run through `uv run --project apps/api --frozen python seed.py <command>`,
from a run directory with no `.env`, so `Settings` reads only the
environment `e2e-http/env.ts` builds. Every write goes through
`planora_api`'s own repository functions rather than
hand-written SQL, so a schema or hashing change cannot silently drift from
what this helper writes. It lives beside the smoke suite, never inside
`apps/api/src/planora_api`, so it never ships.

Commands:
  seed-task <title> <status>        an active task in a column (todo, in_progress, done)
  seed-archived-task <title>        a Done task completed and archived 8 days ago
  count-tasks <title>               print how many tasks (archived or not) have this title
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from planora_api.config import load_settings
from planora_api.db import task_repository
from planora_api.db.models import Task, TaskStatus
from planora_api.db.session import create_session_factory, session_scope
from planora_api.schemas.task import TaskCreate


def main(argv: list[str]) -> int:
    factory = create_session_factory(load_settings())
    engine = factory.kw["bind"]
    try:
        command, args = argv[0], argv[1:]
        now = datetime.now(UTC)
        with session_scope(factory) as db:
            if command == "seed-task":
                title, status = args
                task_repository.create_task_from_request(
                    db,
                    TaskCreate(title=title, content="Seeded.", status=TaskStatus(status)),
                    now,
                )
            elif command == "seed-archived-task":
                (title,) = args
                task = task_repository.create_task_from_request(
                    db,
                    TaskCreate(title=title, content="Seeded as already archived.", status=TaskStatus.DONE),
                    now,
                )
                eight_days_ago = now - timedelta(days=8)
                task.completed_at = eight_days_ago
                task.archived_at = eight_days_ago
            elif command == "count-tasks":
                (title,) = args
                count = db.execute(
                    select(func.count()).select_from(Task).where(Task.title == title)
                ).scalar_one()
                print(count)
            else:
                print(f"unknown command: {command}", file=sys.stderr)
                return 2
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
