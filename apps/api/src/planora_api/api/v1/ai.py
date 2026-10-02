"""`/api/v1/ai` — natural-language task-text parsing (issue #38, spec
§6.2, §10.4, §13.1).

Thin by design, matching `api.v1.tasks`: this module validates the
request, resolves the effective model and timezone (#31), and delegates
extraction to `ai.parse_task.parse_task_text`. It never calls a repository
write function — the LLM may only propose values (spec §6.2); `db` is
used only to read the effective Settings.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from planora_api.ai.client import LLMClient
from planora_api.ai.deps import get_llm_client, run_cancellable
from planora_api.ai.parse_task import parse_task_text
from planora_api.api.deps import (
    DbSession,
    get_current_time,
    get_settings,
    require_session,
)
from planora_api.config import Settings
from planora_api.db import settings_repository
from planora_api.db.models import AuthSession
from planora_api.errors import (
    ERROR_RESPONSE,
    VALIDATION_RESPONSE,
    WRITE_RESPONSES,
)
from planora_api.schemas.ai import ParsedTaskResponse, ParseTaskRequest
from planora_api.schemas.task import TaskUrl

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])

_PARSE_RESPONSES = {
    **WRITE_RESPONSES,
    422: VALIDATION_RESPONSE,
    503: ERROR_RESPONSE,
}


@router.post("/parse-task", response_model=ParsedTaskResponse, responses=_PARSE_RESPONSES)
async def parse_task(
    body: ParseTaskRequest,
    request: Request,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_current_time)],
    llm: Annotated[LLMClient, Depends(get_llm_client)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> ParsedTaskResponse:
    effective = settings_repository.get_effective_settings(db, settings)

    draft = await run_cancellable(
        request,
        parse_task_text(
            llm=llm,
            text=body.text,
            now=now,
            timezone_name=effective.timezone,
            model=effective.model_name,
        ),
    )

    return ParsedTaskResponse(
        title=draft.title,
        content=draft.content,
        category=draft.category,
        priority=draft.priority,
        deadline_at=draft.deadline_at,
        urls=[TaskUrl(url=item["url"], label=item["label"]) for item in draft.urls],
        markdown_note=draft.markdown_note,
    )
