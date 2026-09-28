"""Repository functions for the single `app_settings` row (issue #31).

Mirrors `db/auth_repository.py`'s shape for `app_user`: `get_app_settings`
is a read-only lookup, `update_app_settings` creates-or-updates the single
row in place, and `get_effective_settings` is the one function later
issues (#37 for `model_name`, #38 for `timezone`) call instead of
re-deriving the override-vs-deployment-default fallback themselves.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from planora_api.config import Settings
from planora_api.db.models import AppSettings

# `app_settings.id` is always 1 — the table's `CHECK (id = 1)` constraint
# allows no other value (mirrors `auth_repository._SINGLE_USER_ID`).
_SINGLE_SETTINGS_ID = 1

# Sentinel distinguishing "field left out of this update" from "field
# explicitly set to some value" — `None` itself is not usable as that
# sentinel here because clearing a field back to "follow deployment" is
# not part of this contract (the wire schema rejects an explicit `null`
# for either field; see `schemas/settings.py`). Public so `api.v1.settings`
# can pass it explicitly for a field the request body did not include.
UNSET: Any = object()


@dataclass(frozen=True)
class EffectiveSettings:
    """The settings actually in effect: each field is either the user's
    stored override or the deployment default, never `None`."""

    timezone: str
    model_name: str


def get_app_settings(db: Session) -> AppSettings | None:
    """Return the single overrides row, or `None` if it does not exist yet
    (no `PATCH` has ever succeeded)."""
    return db.get(AppSettings, _SINGLE_SETTINGS_ID)


def get_effective_settings(db: Session, settings: Settings) -> EffectiveSettings:
    """The settings actually in effect: a stored override where the user
    has set one, else the deployment value from `config.Settings`.

    Read-only — never creates a row. The sole function later issues (#37,
    #38) should call for the effective `model_name` / `timezone` instead
    of re-deriving this fallback.
    """
    row = get_app_settings(db)
    timezone = row.timezone if row is not None and row.timezone else settings.default_timezone
    model_name = row.model_name if row is not None and row.model_name else settings.llm_model
    return EffectiveSettings(timezone=timezone, model_name=model_name)


def update_app_settings(
    db: Session,
    *,
    now: datetime,
    timezone: str | None = UNSET,
    model_name: str | None = UNSET,
) -> AppSettings | None:
    """Apply a partial update to the single overrides row, creating it on
    first use.

    A field left at `UNSET` (not passed) is untouched — a `PATCH` that
    supplies neither field changes nothing at all, not even `updated_at`,
    and creates no row where none existed (matching the "PATCH {} changes
    nothing" acceptance criterion). Passing both `timezone=None` and
    `model_name=None` would be a caller bug — this repository is never
    asked to clear an override back to the deployment default; the wire
    schema (`schemas/settings.py`) rejects an explicit `null` before this
    function is ever reached.

    Returns the row (existing or newly created), or the existing row
    unchanged if nothing was supplied, or `None` if nothing was supplied
    and no row exists yet.
    """
    if timezone is UNSET and model_name is UNSET:
        return get_app_settings(db)

    row = get_app_settings(db)
    if row is None:
        row = AppSettings(id=_SINGLE_SETTINGS_ID, timezone=None, model_name=None, updated_at=now)
        db.add(row)
    if timezone is not UNSET:
        row.timezone = timezone
    if model_name is not UNSET:
        row.model_name = model_name
    row.updated_at = now
    db.flush()
    return row
