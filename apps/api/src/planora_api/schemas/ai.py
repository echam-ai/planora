"""Wire schemas for `/api/v1/ai` (issue #38, spec §6.2, §10.4).

`snake_case` field names, matching the wire contract exactly (binding rule
2). The API tier is the only authority on these rules (binding rule 1).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from planora_api.db.models import TaskCategory, TaskPriority
from planora_api.schemas.common import TrimmedText
from planora_api.schemas.task import TaskUrl


class ParseTaskRequest(BaseModel):
    """`POST /api/v1/ai/parse-task` request body. `text` is required to be
    1 to 4000 characters *after* trimming; the trimmed value is what the
    router and the model both see — an over-length, empty, whitespace-only,
    missing or non-string `text` is rejected here, before the model is
    ever called."""

    model_config = ConfigDict(extra="forbid")

    text: TrimmedText


class ParsedTaskResponse(BaseModel):
    """The `TaskDraft` wire shape (spec §6.2) — exactly what a confirmed
    preview later posts, unchanged, to `POST /api/v1/tasks`
    (`schemas.task.TaskCreate` minus `status`). No `id`, no `status`, and
    no server timestamp: this is a proposal, not a persisted task (spec
    §6.2: "The LLM may only propose values. It does not save a task
    directly")."""

    model_config = ConfigDict(extra="forbid")

    title: str
    content: str
    category: TaskCategory
    priority: TaskPriority
    deadline_at: datetime | None = None
    urls: list[TaskUrl] = Field(default_factory=list)
    markdown_note: str = ""
