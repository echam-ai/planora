"""The assistant's four proposal tools (issue #41, spec §10.1-§10.4):
`propose_create_task`, `propose_update_task`, `propose_move_task` and
`propose_set_deadline`.

Every executor here is still **read-only against the database** — exactly
like `ai.chat_tools`'s two read tools. A tool call that validates and
represents a real change never writes a `chat_action` (or `task`) row
itself; it only returns a `ToolExecutionResult` whose `.proposal` is a
`PendingProposal` for `ai.chat`'s loop to accumulate in memory. Nothing is
persisted until the whole `send_chat_message` call succeeds and
`api.v1.chat.send_message` writes it — see both modules' docstrings. This
is what makes "no proposal, message or task row is persisted" on a
later-round LLM failure automatic rather than something this module has to
get right on its own.

A tool call that is invalid, targets an unknown/archived task, or would be
a no-op change returns the shared `TOOL_CALL_ERROR_RESULT` and produces no
proposal at all — never partially.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from planora_api.ai.chat_tools import (
    TOOL_CALL_ERROR_RESULT,
    PendingProposal,
    ToolExecutionResult,
    ToolSpec,
)
from planora_api.db import task_repository
from planora_api.db.models import TaskCategory, TaskPriority, TaskStatus
from planora_api.domain import chat_actions
from planora_api.domain.local_time import (
    local_wall_clock_to_utc,
    parse_local_wall_clock,
)
from planora_api.schemas.task import TaskUrl


def _resolve_deadline(deadline: str | None, timezone_name: str) -> datetime | None:
    if deadline is None:
        return None
    local_dt = parse_local_wall_clock(deadline)
    return local_wall_clock_to_utc(local_dt, timezone_name)


def _validate_deadline_string(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        parse_local_wall_clock(value)
    except ValueError as exc:
        raise ValueError(
            "deadline must be a real calendar YYYY-MM-DD or YYYY-MM-DDTHH:MM value"
        ) from exc
    return value


def _non_blank(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError("must not be blank")
    return stripped


def _draft_payload(
    *,
    title: str,
    content: str,
    category: TaskCategory,
    priority: TaskPriority,
    deadline_at: datetime | None,
    urls: list[dict[str, str | None]],
    markdown_note: str = "",
) -> dict[str, Any]:
    return {
        "title": title,
        "content": content,
        "category": category.value,
        "priority": priority.value,
        "deadline_at": deadline_at.isoformat() if deadline_at else None,
        "urls": urls,
        "markdown_note": markdown_note,
    }


# --- propose_create_task ------------------------------------------------------


class ProposeCreateTaskArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    content: str
    category: TaskCategory
    priority: TaskPriority
    deadline: str | None = None
    urls: list[TaskUrl] = Field(default_factory=list)

    @field_validator("title", "content")
    @classmethod
    def _non_blank_field(cls, value: str) -> str:
        return _non_blank(value)

    @field_validator("deadline")
    @classmethod
    def _deadline_is_valid(cls, value: str | None) -> str | None:
        return _validate_deadline_string(value)


PROPOSE_CREATE_TASK_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "propose_create_task",
        "description": (
            "Propose creating a new task. This does not create the task — "
            "it shows the user a preview they must confirm. The task is "
            "always created in the Todo column."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "title": {"type": "string"},
                "content": {"type": "string"},
                "category": {"type": "string", "enum": [m.value for m in TaskCategory]},
                "priority": {"type": "string", "enum": [m.value for m in TaskPriority]},
                "deadline": {
                    "type": ["string", "null"],
                    "description": (
                        "YYYY-MM-DD (end of day) or YYYY-MM-DDTHH:MM, local wall-clock "
                        "time in the current Settings timezone, or null for no deadline."
                    ),
                },
                "urls": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "url": {"type": "string"},
                            "label": {"type": ["string", "null"]},
                        },
                        "required": ["url"],
                    },
                },
            },
            "required": ["title", "content", "category", "priority"],
        },
    },
}


def propose_create_task(
    db: Session, args: ProposeCreateTaskArgs, now: datetime, timezone_name: str
) -> ToolExecutionResult:
    del db, now
    deadline_at = _resolve_deadline(args.deadline, timezone_name)
    urls = [url.model_dump() for url in args.urls]
    fields = chat_actions.create_fields(
        title=args.title,
        content=args.content,
        category=args.category.value,
        priority=args.priority.value,
        deadline_at=deadline_at,
        urls=urls,
        timezone_name=timezone_name,
    )
    draft = _draft_payload(
        title=args.title,
        content=args.content,
        category=args.category,
        priority=args.priority,
        deadline_at=deadline_at,
        urls=urls,
    )
    proposal = PendingProposal(
        kind="create",
        title=chat_actions.ACTION_TITLES["create"],
        summary=args.title,
        fields=fields,
        payload={"draft": draft},
        task_id=None,
        stale_snapshot={},
    )
    return ToolExecutionResult(tool_result={"status": "pending_confirmation"}, proposal=proposal)


# --- propose_update_task -------------------------------------------------------


class ProposeUpdateTaskArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: UUID
    title: str | None = None
    content: str | None = None
    category: TaskCategory | None = None
    priority: TaskPriority | None = None

    @field_validator("title", "content")
    @classmethod
    def _non_blank_if_present(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _non_blank(value)


PROPOSE_UPDATE_TASK_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "propose_update_task",
        "description": (
            "Propose changing one or more of an existing task's title, content, "
            "category or priority. This does not apply the change — it shows the "
            "user a preview they must confirm. Cannot change status or deadline; "
            "use propose_move_task or propose_set_deadline for those."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "task_id": {"type": "string"},
                "title": {"type": "string"},
                "content": {"type": "string"},
                "category": {"type": "string", "enum": [m.value for m in TaskCategory]},
                "priority": {"type": "string", "enum": [m.value for m in TaskPriority]},
            },
            "required": ["task_id"],
        },
    },
}


def propose_update_task(
    db: Session, args: ProposeUpdateTaskArgs, now: datetime, timezone_name: str
) -> ToolExecutionResult:
    del now
    task = task_repository.get_active_task(db, args.task_id)
    if task is None:
        return ToolExecutionResult(tool_result=TOOL_CALL_ERROR_RESULT)

    current = {
        "title": task.title,
        "content": task.content,
        "category": task.category.value,
        "priority": task.priority.value,
    }
    proposed: dict[str, str] = {}
    if args.title is not None:
        proposed["title"] = args.title
    if args.content is not None:
        proposed["content"] = args.content
    if args.category is not None:
        proposed["category"] = args.category.value
    if args.priority is not None:
        proposed["priority"] = args.priority.value

    changed_keys = chat_actions.changed_update_keys(current=current, proposed=proposed)
    if not changed_keys:
        return ToolExecutionResult(tool_result=TOOL_CALL_ERROR_RESULT)

    fields = chat_actions.update_fields(
        current=current, proposed=proposed, timezone_name=timezone_name
    )
    changed_fields = {key: proposed[key] for key in changed_keys}
    snapshot = {key: current[key] for key in changed_keys}

    draft = _draft_payload(
        title=proposed.get("title", current["title"]),
        content=proposed.get("content", current["content"]),
        category=TaskCategory(proposed.get("category", current["category"])),
        priority=TaskPriority(proposed.get("priority", current["priority"])),
        deadline_at=task.deadline_at,
        urls=list(task.urls),
        markdown_note=task.markdown_note,
    )
    proposal = PendingProposal(
        kind="update",
        title=chat_actions.ACTION_TITLES["update"],
        summary=task.title,
        fields=fields,
        payload={"task_id": str(task.id), "draft": draft},
        task_id=task.id,
        stale_snapshot=snapshot,
        changed_fields=changed_fields,
    )
    return ToolExecutionResult(tool_result={"status": "pending_confirmation"}, proposal=proposal)


# --- propose_move_task ----------------------------------------------------------


class ProposeMoveTaskArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: UUID
    status: TaskStatus


PROPOSE_MOVE_TASK_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "propose_move_task",
        "description": (
            "Propose moving an existing task to a different board column "
            "(todo, in_progress or done). This does not move the task — it "
            "shows the user a preview they must confirm."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "task_id": {"type": "string"},
                "status": {"type": "string", "enum": [m.value for m in TaskStatus]},
            },
            "required": ["task_id", "status"],
        },
    },
}


def propose_move_task(
    db: Session, args: ProposeMoveTaskArgs, now: datetime, timezone_name: str
) -> ToolExecutionResult:
    del now, timezone_name
    task = task_repository.get_active_task(db, args.task_id)
    if task is None:
        return ToolExecutionResult(tool_result=TOOL_CALL_ERROR_RESULT)

    field = chat_actions.move_field(
        current_status=task.status.value, new_status=args.status.value
    )
    if field is None:
        return ToolExecutionResult(tool_result=TOOL_CALL_ERROR_RESULT)

    proposal = PendingProposal(
        kind="move",
        title=chat_actions.ACTION_TITLES["move"],
        summary=task.title,
        fields=[field],
        payload={"task_id": str(task.id), "status": args.status.value},
        task_id=task.id,
        stale_snapshot={"status": task.status.value},
    )
    return ToolExecutionResult(tool_result={"status": "pending_confirmation"}, proposal=proposal)


# --- propose_set_deadline -------------------------------------------------------


class ProposeSetDeadlineArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: UUID
    deadline: str | None

    @field_validator("deadline")
    @classmethod
    def _deadline_is_valid(cls, value: str | None) -> str | None:
        return _validate_deadline_string(value)


PROPOSE_SET_DEADLINE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "propose_set_deadline",
        "description": (
            "Propose setting or removing an existing task's deadline. This "
            "does not apply the change — it shows the user a preview they "
            "must confirm. Pass null to remove the deadline."
        ),
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "task_id": {"type": "string"},
                "deadline": {
                    "type": ["string", "null"],
                    "description": (
                        "YYYY-MM-DD (end of day) or YYYY-MM-DDTHH:MM, local wall-clock "
                        "time in the current Settings timezone, or null to remove."
                    ),
                },
            },
            "required": ["task_id", "deadline"],
        },
    },
}


def propose_set_deadline(
    db: Session, args: ProposeSetDeadlineArgs, now: datetime, timezone_name: str
) -> ToolExecutionResult:
    del now
    task = task_repository.get_active_task(db, args.task_id)
    if task is None:
        return ToolExecutionResult(tool_result=TOOL_CALL_ERROR_RESULT)

    new_deadline_at = _resolve_deadline(args.deadline, timezone_name)
    field = chat_actions.schedule_field(
        current_deadline_at=task.deadline_at,
        new_deadline_at=new_deadline_at,
        timezone_name=timezone_name,
    )
    if field is None:
        return ToolExecutionResult(tool_result=TOOL_CALL_ERROR_RESULT)

    proposal = PendingProposal(
        kind="schedule",
        title=chat_actions.ACTION_TITLES["schedule"],
        summary=task.title,
        fields=[field],
        payload={
            "task_id": str(task.id),
            "deadline_at": new_deadline_at.isoformat() if new_deadline_at else None,
        },
        task_id=task.id,
        stale_snapshot={
            "deadline_at": task.deadline_at.isoformat() if task.deadline_at else None
        },
    )
    return ToolExecutionResult(tool_result={"status": "pending_confirmation"}, proposal=proposal)


# --- Dispatch table -----------------------------------------------------------

TOOL_REGISTRY: dict[str, ToolSpec] = {
    "propose_create_task": ToolSpec(
        definition=PROPOSE_CREATE_TASK_TOOL,
        args_model=ProposeCreateTaskArgs,
        executor=propose_create_task,
    ),
    "propose_update_task": ToolSpec(
        definition=PROPOSE_UPDATE_TASK_TOOL,
        args_model=ProposeUpdateTaskArgs,
        executor=propose_update_task,
    ),
    "propose_move_task": ToolSpec(
        definition=PROPOSE_MOVE_TASK_TOOL,
        args_model=ProposeMoveTaskArgs,
        executor=propose_move_task,
    ),
    "propose_set_deadline": ToolSpec(
        definition=PROPOSE_SET_DEADLINE_TOOL,
        args_model=ProposeSetDeadlineArgs,
        executor=propose_set_deadline,
    ),
}

# The 4 tool names `ai.chat._execute_tool_call` counts against the
# per-turn proposal cap (spec §41: "at most 5 proposals").
PROPOSAL_TOOL_NAMES: frozenset[str] = frozenset(TOOL_REGISTRY.keys())
