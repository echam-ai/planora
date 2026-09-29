"""The assistant's two read-only tools (issue #40, spec §10.1, §10.4):
`find_active_tasks` and `search_archive`.

Tool definitions (OpenAI-compatible `tools=` entries), their server-side
pydantic argument schemas, and their executors all live here, matching
`ai.parse_task`'s split between prompt-building (`ai.prompts`) and
extraction. `ai.chat` owns the tool-call loop that dispatches into
`TOOL_REGISTRY`; this module never talks to the LLM client itself.

Every executor is read-only — neither ever calls a repository write
function, and `tests/integration/test_chat_tools.py` asserts that under a
SQLAlchemy `before_cursor_execute` listener no non-`SELECT` statement is
ever issued by either one. Each result carries only the minimum task data
spec §10.4 allows ("only the minimum task data required to answer the
request") — never `content`, `markdown_note`, or `urls`.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from planora_api.db import task_repository
from planora_api.db.models import Task, TaskCategory, TaskPriority, TaskStatus
from planora_api.domain.chat_filters import ActiveTaskFilters, active_task_matches
from planora_api.domain.deadline import deadline_state

logger = logging.getLogger("planora_api.ai.chat_tools")

# spec §10.4: "the minimum task data required to answer the request" — a
# single hard cap on every tool result, active or archive.
MAX_RESULTS = 50

_TITLE_CONTAINS_MAX_LENGTH = 200

# The four filterable deadline states (spec §7.4): `"completed"` is
# deliberately not a member here — it is never a valid tool argument, so a
# Done task (whose derived state is always `"completed"`) can never be
# requested and therefore matches no `deadline_states` filter.
_FilterableDeadlineState = Literal["none", "scheduled", "due_soon", "overdue"]

# The one fixed, safe body sent back to the model for a tool call that is
# never executed — unknown name, invalid JSON, or a schema-failing
# argument. Carries no detail about *why* (never the raw arguments, which
# could contain task content or an injected string) — see `ai.chat`.
TOOL_CALL_ERROR_RESULT: dict[str, str] = {"error": "invalid_tool_call"}


def _log_tool_call(
    name: str, *, outcome: str, count: int | None, started: float
) -> None:
    """spec §15.5: only the tool name, result count, duration and outcome
    — never arguments, never a task title or other task content."""
    logger.info(
        "chat_tool_call",
        extra={
            "tool": name,
            "outcome": outcome,
            "count": count,
            "duration_ms": round((time.perf_counter() - started) * 1000, 3),
        },
    )


# --- find_active_tasks -------------------------------------------------------


class FindActiveTasksArgs(BaseModel):
    """Every argument is optional; extra keys are rejected. `title_contains`
    is trimmed to at most 200 characters — blank after trimming behaves
    exactly like an absent value (spec §7.4: an empty dimension doesn't
    filter)."""

    model_config = ConfigDict(extra="forbid")

    title_contains: str | None = None
    statuses: list[TaskStatus] = Field(default_factory=list)
    categories: list[TaskCategory] = Field(default_factory=list)
    priorities: list[TaskPriority] = Field(default_factory=list)
    deadline_states: list[_FilterableDeadlineState] = Field(default_factory=list)

    @field_validator("title_contains")
    @classmethod
    def _trim_title_contains(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()[:_TITLE_CONTAINS_MAX_LENGTH]
        return stripped or None


FIND_ACTIVE_TASKS_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "find_active_tasks",
        "description": (
            "Search non-archived tasks on the board. All arguments are "
            "optional; omit an argument to not filter on it. Returns at "
            "most 50 matching tasks in board order (status column, then "
            "position), plus the total match count."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "title_contains": {
                    "type": "string",
                    "description": "Case-insensitive substring match on the task title only.",
                },
                "statuses": {
                    "type": "array",
                    "items": {"type": "string", "enum": [m.value for m in TaskStatus]},
                },
                "categories": {
                    "type": "array",
                    "items": {"type": "string", "enum": [m.value for m in TaskCategory]},
                },
                "priorities": {
                    "type": "array",
                    "items": {"type": "string", "enum": [m.value for m in TaskPriority]},
                },
                "deadline_states": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["none", "scheduled", "due_soon", "overdue"],
                    },
                    "description": (
                        "A Done task matches no deadline_states value, even "
                        "'overdue' — completion is not a deadline state here."
                    ),
                },
            },
        },
    },
}


def _serialize_active_task(task: Task, *, now: datetime, tz: ZoneInfo) -> dict[str, Any]:
    return {
        "id": str(task.id),
        "title": task.title,
        "status": task.status.value,
        "category": task.category.value,
        "priority": task.priority.value,
        "deadline_at": task.deadline_at.astimezone(tz).isoformat() if task.deadline_at else None,
        "deadline_state": deadline_state(task.deadline_at, task.status.value, now),
    }


def find_active_tasks(
    db: Session, args: FindActiveTasksArgs, *, now: datetime, timezone_name: str
) -> dict[str, Any]:
    """spec §7.4 filter semantics via `domain.chat_filters`; board order
    (status column, then position) via `task_repository.list_active_tasks`,
    which this reuses rather than re-deriving that order here."""
    filters = ActiveTaskFilters(
        title_contains=args.title_contains,
        statuses=tuple(status.value for status in args.statuses),
        categories=tuple(category.value for category in args.categories),
        priorities=tuple(priority.value for priority in args.priorities),
        deadline_states=tuple(args.deadline_states),
    )
    tz = ZoneInfo(timezone_name)
    matches = [
        task
        for task in task_repository.list_active_tasks(db)
        if active_task_matches(
            title=task.title,
            status=task.status.value,
            category=task.category.value,
            priority=task.priority.value,
            deadline_at=task.deadline_at,
            now=now,
            filters=filters,
        )
    ]
    total = len(matches)
    tasks = [_serialize_active_task(task, now=now, tz=tz) for task in matches[:MAX_RESULTS]]
    return {"tasks": tasks, "total": total, "truncated": total > MAX_RESULTS}


# --- search_archive -----------------------------------------------------------


class SearchArchiveArgs(BaseModel):
    """`title_contains` is required, 1 to 200 characters after trimming;
    extra keys are rejected."""

    model_config = ConfigDict(extra="forbid")

    title_contains: str

    @field_validator("title_contains")
    @classmethod
    def _title_contains_is_1_to_200_chars_after_trimming(cls, value: str) -> str:
        stripped = value.strip()
        if not (1 <= len(stripped) <= _TITLE_CONTAINS_MAX_LENGTH):
            raise ValueError(
                f"title_contains must be 1 to {_TITLE_CONTAINS_MAX_LENGTH} "
                "characters after trimming"
            )
        return stripped


SEARCH_ARCHIVE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "search_archive",
        "description": (
            "Search archived (completed and no longer active) tasks by "
            "title. Case-insensitive substring match on the title only — "
            "never on content, notes, or URLs. Returns at most 50 matching "
            "tasks, newest completion first, plus the total match count."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "title_contains": {
                    "type": "string",
                    "description": "Required. 1 to 200 characters after trimming.",
                }
            },
            "required": ["title_contains"],
        },
    },
}


def _serialize_archived_task(task: Task, *, tz: ZoneInfo) -> dict[str, Any]:
    return {
        "id": str(task.id),
        "title": task.title,
        "category": task.category.value,
        "priority": task.priority.value,
        "completed_at": task.completed_at.astimezone(tz).isoformat() if task.completed_at else None,
        "archived_at": task.archived_at.astimezone(tz).isoformat() if task.archived_at else None,
    }


def search_archive(
    db: Session, args: SearchArchiveArgs, *, now: datetime, timezone_name: str
) -> dict[str, Any]:
    """`now` is accepted only to keep the same executor signature as
    `find_active_tasks` (see `ToolSpec.executor` below) — archive search
    needs no reference instant. Reuses `task_repository.list_archived_tasks`
    semantics exactly (spec §9.2): case-insensitive title substring,
    newest completion first."""
    del now
    items, total = task_repository.list_archived_tasks(
        db, search=args.title_contains, page=1, page_size=MAX_RESULTS
    )
    tz = ZoneInfo(timezone_name)
    tasks = [_serialize_archived_task(task, tz=tz) for task in items]
    return {"tasks": tasks, "total": total, "truncated": total > MAX_RESULTS}


# --- Dispatch table -----------------------------------------------------------


@dataclass(frozen=True)
class ToolSpec:
    definition: Mapping[str, Any]
    args_model: type[BaseModel]
    executor: Callable[[Session, Any, datetime, str], dict[str, Any]]


def _find_active_tasks_executor(
    db: Session, args: FindActiveTasksArgs, now: datetime, timezone_name: str
) -> dict[str, Any]:
    return find_active_tasks(db, args, now=now, timezone_name=timezone_name)


def _search_archive_executor(
    db: Session, args: SearchArchiveArgs, now: datetime, timezone_name: str
) -> dict[str, Any]:
    return search_archive(db, args, now=now, timezone_name=timezone_name)


# Exactly the two read tools spec §10.1 allows in v1. `ai.chat` sends
# `TOOL_DEFINITIONS` as the `tools=` argument on every `complete()` call and
# dispatches an incoming tool call through `TOOL_REGISTRY` by name — an
# unknown name (including a write-like one such as `create_task`) simply
# isn't a key here, so it is never executed.
TOOL_REGISTRY: dict[str, ToolSpec] = {
    "find_active_tasks": ToolSpec(
        definition=FIND_ACTIVE_TASKS_TOOL,
        args_model=FindActiveTasksArgs,
        executor=_find_active_tasks_executor,
    ),
    "search_archive": ToolSpec(
        definition=SEARCH_ARCHIVE_TOOL,
        args_model=SearchArchiveArgs,
        executor=_search_archive_executor,
    ),
}

TOOL_DEFINITIONS: tuple[Mapping[str, Any], ...] = tuple(
    spec.definition for spec in TOOL_REGISTRY.values()
)
