"""`/api/v1/settings` — read/update timezone and model-name settings, and
change the password (issue #31, spec §11, §3.2).

Thin by design, matching `api.v1.auth` and `api.v1.archive`: this module
validates the request, delegates persistence to `db.settings_repository`
and `db.auth_repository`, delegates hashing to `security.password` and
session revocation to `security.session`, and shapes the response. It
imports `security.password` and `security.session` as modules (not their
individual functions), matching `api.v1.auth`, so a test can spy on
`password_security.verify_password`.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from fastapi.exceptions import RequestValidationError

from planora_api.api.deps import (
    DbSession,
    get_current_time,
    get_settings,
    require_session,
)
from planora_api.config import Settings
from planora_api.db import auth_repository, settings_repository
from planora_api.db.models import AuthSession
from planora_api.errors import (
    AUTH_RESPONSES,
    ERROR_RESPONSE,
    VALIDATION_RESPONSE,
    WRITE_RESPONSES,
    ApiError,
)
from planora_api.schemas.settings import (
    PasswordChangeRequest,
    SettingsResponse,
    SettingsUpdate,
)
from planora_api.security import password as password_security
from planora_api.security import session as session_security

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])

_WRONG_PASSWORD_MESSAGE = "The current password is incorrect."

_VALIDATED_WRITE_RESPONSES = {**WRITE_RESPONSES, 422: VALIDATION_RESPONSE}
_PASSWORD_RESPONSES = {**_VALIDATED_WRITE_RESPONSES, 400: ERROR_RESPONSE}


def _effective_response(db: DbSession, settings: Settings) -> SettingsResponse:
    effective = settings_repository.get_effective_settings(db, settings)
    return SettingsResponse(
        timezone=effective.timezone,
        model_name=effective.model_name,
        available_models=settings.available_models(),
    )


@router.get("", response_model=SettingsResponse, responses=AUTH_RESPONSES)
def read_settings(
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    _session: Annotated[AuthSession, Depends(require_session)],
) -> SettingsResponse:
    return _effective_response(db, settings)


@router.patch("", response_model=SettingsResponse, responses=_VALIDATED_WRITE_RESPONSES)
def update_settings(
    body: SettingsUpdate,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_current_time)],
    _session: Annotated[AuthSession, Depends(require_session)],
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


@router.post("/password", status_code=204, responses=_PASSWORD_RESPONSES)
def change_password(
    body: PasswordChangeRequest,
    db: DbSession,
    now: Annotated[datetime, Depends(get_current_time)],
    session: Annotated[AuthSession, Depends(require_session)],
) -> Response:
    user = auth_repository.get_app_user(db)
    if user is None:
        # A valid session with no matching app_user row isn't reachable
        # through the real login flow (login requires a user to create a
        # session in the first place), but never trust a session row to
        # imply a user row exists — matches api.v1.auth.read_session's own
        # defensive check.
        raise ApiError(401, "NOT_AUTHENTICATED", "Sign in required.")

    # Exactly one Argon2 verification against the stored hash.
    if not password_security.verify_password(user.password_hash, body.current_password):
        raise ApiError(400, "WRONG_PASSWORD", _WRONG_PASSWORD_MESSAGE)

    auth_repository.upsert_app_user(
        db,
        username=user.username,
        password_hash=password_security.hash_password(body.new_password),
        now=now,
    )
    # Revoke every other session; the one that made this change stays
    # valid and gets no new cookie.
    session_security.delete_other_sessions(db, session.token_digest)

    return Response(status_code=204)
