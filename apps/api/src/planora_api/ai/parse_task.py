"""Natural-language task-text parsing (issue #38, spec §6.2, §10.4).

`parse_task_text` sends the user's free text to the configured LLM and
requests schema-constrained output via `response_format={"type":
"json_schema", ...}` — chosen over a forced tool call because this is a
single-shot extraction with no need for tool-call semantics, and
`json_schema` is what OpenAI-compatible `/chat/completions` endpoints
support directly for this. The raw output (`completion.content`, expected
to be a JSON string) is parsed through a strict pydantic model
(`_ParsedTaskOutput`, `extra="forbid"`) before anything is returned. Any
malformed shape — not JSON, wrong top-level type, an unknown field, a
`category`/`priority` outside the §5 enums, a malformed/impossible date, or
a non-string title — raises `LLMUnavailableError(reason="invalid_response")`
(from #37), which #37's registered handler turns into `503 AI_UNAVAILABLE`.
Nothing here ever returns a partial draft.

This module never writes to the database and never gives the model a tool
or database content: `api/v1/ai.py`'s router never calls a repository
write function, and the messages built here carry only the system prompt
(`ai.prompts`), the user's own text, and nothing else.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, time
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from planora_api.ai.client import LLMClient, LLMUnavailableError
from planora_api.ai.prompts import (
    build_parse_task_system_prompt,
    build_parse_task_user_message,
)
from planora_api.db.models import TaskCategory, TaskPriority
from planora_api.domain.local_time import local_wall_clock_to_utc

# spec §6.2: "Generated short title when no clear title exists", truncated
# at 120 characters when the model's own title runs longer.
_TITLE_MAX_LENGTH = 120
# Matches `TaskUrl.label`'s own cap (issue #38 grooming).
_LABEL_MAX_LENGTH = 200

_ALLOWED_URL_SCHEMES = frozenset({"http", "https"})

_DATE_ONLY_FORMAT = "%Y-%m-%d"
_DATE_TIME_FORMAT = "%Y-%m-%dT%H:%M"
# A bare date means end of day local time (pinned at grooming; spec gives
# no other rule for "by Friday" with no time).
_END_OF_DAY = time(23, 59)


def _parse_local_datetime(value: str) -> datetime:
    """Raises `ValueError` for anything not exactly `YYYY-MM-DD` or
    `YYYY-MM-DDTHH:MM`, including a calendar-impossible date/time
    (`strptime` itself rejects e.g. `2026-02-30` or hour `25`)."""
    if "T" in value:
        return datetime.strptime(value, _DATE_TIME_FORMAT)  # noqa: DTZ007 - deliberately naive local wall-clock
    date_only = datetime.strptime(value, _DATE_ONLY_FORMAT)  # noqa: DTZ007 - deliberately naive local wall-clock
    return datetime.combine(date_only.date(), _END_OF_DAY)


class _ParsedUrl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str
    label: str | None = None


class _ParsedTaskOutput(BaseModel):
    """The strict shape `parse_task_text` requires of the model's JSON
    output. Every field the model may omit defaults to `None`/`[]` here —
    the §6.1 defaults are applied afterwards, not by this model — but any
    field the model *does* supply must be exactly the right shape, or the
    whole parse fails (see the module docstring)."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    content: str | None = None
    category: TaskCategory | None = None
    priority: TaskPriority | None = None
    deadline: str | None = None
    urls: list[_ParsedUrl] = Field(default_factory=list)

    @field_validator("deadline")
    @classmethod
    def _deadline_is_a_real_local_timestamp(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            _parse_local_datetime(value)
        except ValueError as exc:
            raise ValueError(
                "deadline must be a real calendar YYYY-MM-DD or YYYY-MM-DDTHH:MM value"
            ) from exc
        return value


@dataclass(frozen=True)
class ParsedTaskDraft:
    """The `TaskDraft` wire shape's values (spec §6.2) — `api/v1/ai.py`
    shapes these into `schemas.ai.ParsedTaskResponse`."""

    title: str
    content: str
    category: TaskCategory
    priority: TaskPriority
    deadline_at: datetime | None
    urls: list[dict[str, str | None]]
    markdown_note: str


def derive_title(model_title: str | None, text: str) -> str:
    """The model's own title, trimmed and capped at 120 characters, or —
    if the model returned none or only blanks — the input's first line,
    capped the same way. `text` is assumed already trimmed (the wire
    schema trims it), so its first line is never blank."""
    if model_title is not None:
        stripped = model_title.strip()
        if stripped:
            return stripped[:_TITLE_MAX_LENGTH]
    first_line = text.splitlines()[0] if text else ""
    return first_line[:_TITLE_MAX_LENGTH]


def derive_content(model_content: str | None, text: str) -> str:
    """The model's own content, trimmed, or the full trimmed input text if
    the model returned none or only blanks."""
    if model_content is not None:
        stripped = model_content.strip()
        if stripped:
            return stripped
    return text


def filter_urls(parsed_urls: list[_ParsedUrl], text: str) -> list[dict[str, str | None]]:
    """Only `http`/`https` URLs that occur **verbatim** in `text` survive —
    a URL the model invented (from injected instructions or otherwise) is
    silently dropped, never returned. Duplicates collapse to their first
    occurrence; a label longer than 200 characters is truncated, never
    rejected (matching how an over-long model title is truncated, not
    rejected)."""
    seen: set[str] = set()
    result: list[dict[str, str | None]] = []
    for item in parsed_urls:
        url = item.url
        if url not in text:
            continue
        scheme = url.split("://", 1)[0].lower() if "://" in url else ""
        if scheme not in _ALLOWED_URL_SCHEMES:
            continue
        if url in seen:
            continue
        seen.add(url)
        label = item.label
        if label is not None:
            stripped_label = label.strip()[:_LABEL_MAX_LENGTH]
            label = stripped_label or None
        result.append({"url": url, "label": label})
    return result


def resolve_deadline(deadline: str | None, timezone_name: str) -> datetime | None:
    """`None` if the model gave no deadline; otherwise the UTC instant for
    the model's local wall-clock value, via `domain.local_time` (a bare
    date means 23:59 local — see `_END_OF_DAY`)."""
    if deadline is None:
        return None
    local_dt = _parse_local_datetime(deadline)
    return local_wall_clock_to_utc(local_dt, timezone_name)


def _response_format() -> dict[str, object]:
    category_values = [member.value for member in TaskCategory]
    priority_values = [member.value for member in TaskPriority]
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "title": {"type": ["string", "null"]},
            "content": {"type": ["string", "null"]},
            "category": {"type": ["string", "null"], "enum": [*category_values, None]},
            "priority": {"type": ["string", "null"], "enum": [*priority_values, None]},
            "deadline": {"type": ["string", "null"]},
            "urls": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "url": {"type": "string"},
                        "label": {"type": ["string", "null"]},
                    },
                    "required": ["url", "label"],
                },
            },
        },
        "required": ["title", "content", "category", "priority", "deadline", "urls"],
    }
    return {
        "type": "json_schema",
        "json_schema": {"name": "task_draft", "strict": True, "schema": schema},
    }


async def parse_task_text(
    *,
    llm: LLMClient,
    text: str,
    now: datetime,
    timezone_name: str,
    model: str,
) -> ParsedTaskDraft:
    """Send `text` to `llm` and return a validated `ParsedTaskDraft`.

    `now`/`timezone_name` (the effective Settings timezone, #31) build the
    prompt's current local date/time/weekday and resolve any deadline the
    model returns; `model` is the caller's already-resolved effective
    model name (#31, per #37's contract). The request carries no tool and
    no database content — only the system prompt (enum values, current
    local date/time/weekday/timezone) and `text` itself, delimited in the
    user turn.
    """
    local_now = now.astimezone(ZoneInfo(timezone_name))
    system_prompt = build_parse_task_system_prompt(
        current_date=local_now.strftime("%Y-%m-%d"),
        current_time=local_now.strftime("%H:%M"),
        current_weekday=local_now.strftime("%A"),
        timezone_name=timezone_name,
        categories=[member.value for member in TaskCategory],
        priorities=[member.value for member in TaskPriority],
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": build_parse_task_user_message(text)},
    ]

    completion = await llm.complete(messages, model=model, response_format=_response_format())

    if completion.content is None:
        raise LLMUnavailableError("invalid_response") from None
    try:
        payload = json.loads(completion.content)
        parsed = _ParsedTaskOutput.model_validate(payload)
    except (ValueError, ValidationError):
        raise LLMUnavailableError("invalid_response") from None

    return ParsedTaskDraft(
        title=derive_title(parsed.title, text),
        content=derive_content(parsed.content, text),
        category=parsed.category or TaskCategory.OTHER,
        priority=parsed.priority or TaskPriority.MEDIUM,
        deadline_at=resolve_deadline(parsed.deadline, timezone_name),
        urls=filter_urls(parsed.urls, text),
        markdown_note="",
    )
