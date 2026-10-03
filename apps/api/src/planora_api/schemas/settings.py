"""Wire schemas for `/api/v1/settings` (spec §11, issue #31).

`snake_case` field names, matching the wire contract exactly (binding rule
2). The API tier is the only authority on these rules (binding rule 1):
every check below runs regardless of what the web Settings form already
validates.
"""

from __future__ import annotations

from zoneinfo import available_timezones

from pydantic import BaseModel, ConfigDict, field_validator

# Computed once at import time — `zoneinfo.available_timezones()` scans the
# installed tzdata, which does not change while the process is running.
# Membership is checked exactly (case-sensitive) against this set, per the
# acceptance criteria: "asia/singapore" (wrong case) is rejected exactly
# like "Mars/Olympus" (not a zone at all).
_VALID_TIMEZONES = frozenset(available_timezones())

_MAX_MODEL_NAME_LENGTH = 200


def _has_control_character(value: str) -> bool:
    return any(ord(char) < 0x20 or ord(char) == 0x7F for char in value)


class SettingsResponse(BaseModel):
    """The full settings wire shape — exactly `timezone`, `model_name` and
    `available_models`, nothing else; never a secret (spec §11).
    `available_models` is read-only: the models the deployment serves."""

    model_config = ConfigDict(extra="forbid")

    timezone: str
    model_name: str
    available_models: list[str]


class SettingsUpdate(BaseModel):
    """`PATCH /api/v1/settings` request body — a partial update.

    Both fields default to `None`, meaning "left out of the body"; the
    router distinguishes that from an explicit value via
    `model_dump(exclude_unset=True)` (pydantic does not run a field
    validator against a default that was never supplied — only against a
    value actually present in the request). An explicit `null` for either
    field is therefore *not* a valid way to clear an override back to the
    deployment default — this schema rejects it outright, matching the
    acceptance criteria.

    Extra fields (`llm_api_key`, `llm_base_url`, `database_url`,
    `session_secret`, `password`, ...) are rejected outright: secrets and
    database configuration are never editable through the browser
    (spec §11).
    """

    model_config = ConfigDict(extra="forbid")

    timezone: str | None = None
    model_name: str | None = None

    @field_validator("timezone")
    @classmethod
    def _timezone_is_valid_iana_zone(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("timezone must not be null")
        if value not in _VALID_TIMEZONES:
            raise ValueError("timezone must be a valid IANA timezone name")
        return value

    @field_validator("model_name")
    @classmethod
    def _model_name_is_valid(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("model_name must not be null")
        stripped = value.strip()
        if not stripped:
            raise ValueError("model_name must not be blank")
        if len(stripped) > _MAX_MODEL_NAME_LENGTH:
            raise ValueError(
                f"model_name must be at most {_MAX_MODEL_NAME_LENGTH} characters"
            )
        if _has_control_character(stripped):
            raise ValueError("model_name must not contain a control character")
        return stripped
