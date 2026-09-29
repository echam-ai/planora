"""Chat proposed-action diffing, field rendering, staleness and legal
transitions (issue #41, spec §10.1-§10.4).

Pure — no I/O (binding rule 5). Every function here takes plain wire-shaped
values (strings, datetimes, mappings) — never a `Task` ORM instance and
never a `planora_api.db` import (enforced by
`tests/unit/test_domain_purity.py`). The caller (`ai.propose_tools`,
`db.chat_action_repository`) reads the task's current field values from the
database and supplies them here; this module only diffs, formats, and
derives an outcome from a stored `status` string.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

ActionKind = Literal["create", "update", "move", "schedule"]
ActionStatus = Literal["pending", "applied", "rejected"]

# spec §41: the fixed title string per proposal kind.
ACTION_TITLES: dict[str, str] = {
    "create": "Create task",
    "update": "Update task",
    "move": "Move task",
    "schedule": "Change deadline",
}

STATUS_LABELS: dict[str, str] = {
    "todo": "Todo",
    "in_progress": "In Progress",
    "done": "Done",
}
CATEGORY_LABELS: dict[str, str] = {
    "work": "Work",
    "personal": "Personal",
    "study": "Study",
    "other": "Other",
}
PRIORITY_LABELS: dict[str, str] = {
    "low": "Low",
    "medium": "Medium",
    "high": "High",
}

FIELD_LABELS: dict[str, str] = {
    "title": "Title",
    "content": "Content",
    "category": "Category",
    "priority": "Priority",
    "status": "Status",
    "deadline": "Deadline",
    "links": "Links",
}

_NO_DEADLINE = "No deadline"

# `update`'s only editable dimensions, in the fixed display order spec §41
# requires for `create`'s field list too.
_UPDATE_KEYS: tuple[str, ...] = ("title", "content", "category", "priority")


def format_deadline(deadline_at: datetime | None, timezone_name: str) -> str:
    """`DD Mon YYYY, HH:MM` (24-hour) in `timezone_name`, matching the
    board's `formatInZone` — or "No deadline" for a null deadline."""
    if deadline_at is None:
        return _NO_DEADLINE
    local = deadline_at.astimezone(ZoneInfo(timezone_name))
    return local.strftime("%d %b %Y, %H:%M")


def format_links(urls: Sequence[Mapping[str, str | None]]) -> str:
    """URLs joined by `", "` — spec §41's `Links` field value."""
    return ", ".join(str(entry["url"]) for entry in urls)


@dataclass(frozen=True)
class ActionField:
    """One `{label, from, to}` entry. `from_value` is `None` only for a
    `create` field (spec §41: "`from` is `null` for `create`")."""

    label: str
    from_value: str | None
    to_value: str


def create_fields(
    *,
    title: str,
    content: str,
    category: str,
    priority: str,
    deadline_at: datetime | None,
    urls: Sequence[Mapping[str, str | None]],
    timezone_name: str,
) -> list[ActionField]:
    """Title, Content, Category, Priority, Deadline, in that order, plus
    Links only when `urls` is non-empty (spec §41)."""
    fields = [
        ActionField(FIELD_LABELS["title"], None, title),
        ActionField(FIELD_LABELS["content"], None, content),
        ActionField(FIELD_LABELS["category"], None, CATEGORY_LABELS[category]),
        ActionField(FIELD_LABELS["priority"], None, PRIORITY_LABELS[priority]),
        ActionField(
            FIELD_LABELS["deadline"], None, format_deadline(deadline_at, timezone_name)
        ),
    ]
    if urls:
        fields.append(ActionField(FIELD_LABELS["links"], None, format_links(urls)))
    return fields


_UPDATE_FORMATTERS = {
    "title": lambda value, _tz: value,
    "content": lambda value, _tz: value,
    "category": lambda value, _tz: CATEGORY_LABELS[value],
    "priority": lambda value, _tz: PRIORITY_LABELS[value],
}


def changed_update_keys(
    *, current: Mapping[str, str], proposed: Mapping[str, str]
) -> list[str]:
    """Which of `_UPDATE_KEYS` are present in `proposed` with a value that
    differs from `current`'s — in fixed order. A key `proposed` doesn't
    mention, or mentions with the same value as `current`, is not a
    change (spec §41: "A value equal to the task's current value is not a
    change")."""
    return [
        key
        for key in _UPDATE_KEYS
        if key in proposed and proposed[key] != current[key]
    ]


def update_fields(
    *, current: Mapping[str, str], proposed: Mapping[str, str], timezone_name: str
) -> list[ActionField]:
    """One entry per key `changed_update_keys` returns, formatted for
    display. Empty when nothing changed — the caller's "no proposal"
    signal."""
    fields: list[ActionField] = []
    for key in changed_update_keys(current=current, proposed=proposed):
        formatter = _UPDATE_FORMATTERS[key]
        fields.append(
            ActionField(
                FIELD_LABELS[key],
                formatter(current[key], timezone_name),
                formatter(proposed[key], timezone_name),
            )
        )
    return fields


def move_field(*, current_status: str, new_status: str) -> ActionField | None:
    """`None` when `new_status` equals `current_status` (spec §41: "Moving
    a task to its current status makes no proposal")."""
    if current_status == new_status:
        return None
    return ActionField(
        FIELD_LABELS["status"],
        STATUS_LABELS[current_status],
        STATUS_LABELS[new_status],
    )


def schedule_field(
    *,
    current_deadline_at: datetime | None,
    new_deadline_at: datetime | None,
    timezone_name: str,
) -> ActionField | None:
    """`None` when `new_deadline_at` equals `current_deadline_at` (spec
    §41: "A value equal to the current deadline makes no proposal")."""
    if current_deadline_at == new_deadline_at:
        return None
    return ActionField(
        FIELD_LABELS["deadline"],
        format_deadline(current_deadline_at, timezone_name),
        format_deadline(new_deadline_at, timezone_name),
    )


def is_stale(*, current: Mapping[str, object], snapshot: Mapping[str, object]) -> bool:
    """Whether any field `snapshot` pins (each preview's stored `from`
    value, raw and unformatted) no longer matches `current`'s live value —
    the confirm-time staleness check (spec §41). `snapshot` is empty for a
    `create` proposal (no target task), so this is always `False` for one;
    the caller is responsible for the separate "task deleted or archived"
    check, which this function cannot see."""
    return any(current.get(key) != value for key, value in snapshot.items())


ConfirmOutcome = Literal["apply", "noop", "already_rejected"]
RejectOutcome = Literal["reject", "noop", "already_applied"]


def confirm_outcome(status: str) -> ConfirmOutcome:
    """The legal `confirm` transition for a stored action `status` (spec
    §41): `pending` applies, `applied` is an idempotent no-op, `rejected`
    is the one illegal transition."""
    if status == "pending":
        return "apply"
    if status == "applied":
        return "noop"
    return "already_rejected"


def reject_outcome(status: str) -> RejectOutcome:
    """The legal `reject` transition for a stored action `status` (spec
    §41): `pending` rejects, `rejected` is an idempotent no-op, `applied`
    is the one illegal transition."""
    if status == "pending":
        return "reject"
    if status == "rejected":
        return "noop"
    return "already_applied"
