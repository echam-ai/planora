"""Profile-specific timezone and model overrides."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.exceptions import RequestValidationError

from planora_api.api.deps import (
    DbSession,
    get_current_time,
    get_settings,
)
from planora_api.config import Settings
from planora_api.db import settings_repository
from planora_api.errors import (
    PROFILE_RESPONSES,
    UNAUTHENTICATED_RESPONSE,
    VALIDATION_RESPONSE,
    WRITE_RESPONSES,
)
from planora_api.schemas.settings import (
    SettingsResponse,
    SettingsUpdate,
)

router = APIRouter(
    prefix="/api/v1/settings", tags=["settings"], responses=UNAUTHENTICATED_RESPONSE
)

_VALIDATED_WRITE_RESPONSES = {**WRITE_RESPONSES, 422: VALIDATION_RESPONSE}


def _effective_response(db: DbSession, settings: Settings) -> SettingsResponse:
    effective = settings_repository.get_effective_settings(db, settings)
    return SettingsResponse(
        timezone=effective.timezone,
        model_name=effective.model_name,
        available_models=settings.available_models(),
    )


@router.get("", response_model=SettingsResponse, responses=PROFILE_RESPONSES)
def read_settings(
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> SettingsResponse:
    return _effective_response(db, settings)


@router.patch("", response_model=SettingsResponse, responses=_VALIDATED_WRITE_RESPONSES)
def update_settings(
    body: SettingsUpdate,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_current_time)],
) -> SettingsResponse:
    provided = body.model_dump(exclude_unset=True)
    # Membership needs the deployment config, so it is checked here, before
    # any write — a rejected model persists nothing, timezone included.
    if "model_name" in provided and provided["model_name"] not in settings.available_models():
        raise RequestValidationError(
            [
                {
                    "type": "value_error",
                    "loc": ("body", "model_name"),
                    "msg": "model_name must be one of the available models",
                }
            ]
        )
    settings_repository.update_app_settings(
        db,
        now=now,
        timezone=provided.get("timezone", settings_repository.UNSET),
        model_name=provided.get("model_name", settings_repository.UNSET),
    )
    return _effective_response(db, settings)
