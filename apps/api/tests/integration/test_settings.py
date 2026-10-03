"""Integration tests for `GET`/`PATCH /api/v1/settings` (issue #31, spec
§11).

Uses the HTTPX `AsyncClient` against the real ASGI app, exactly like
`tests/integration/test_tasks_crud.py`. `migrated_session_factory` applies
the Alembic migration to a disposable SQLite file under the repo's
`.tmp/`, and `app_factory()` builds a fresh app per test against that same
database through `DATABASE_URL`.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import pytest
from conftest import VALID_ENV, make_client
from fastapi import FastAPI
from httpx import AsyncClient, Response
from sqlalchemy.orm import Session, sessionmaker

from planora_api.config import load_settings
from planora_api.db.models import (
    AppSettings,
    Task,
    TaskCategory,
    TaskPriority,
    TaskStatus,
)
from planora_api.db.settings_repository import (
    get_effective_settings,
    update_app_settings,
)

SETTINGS_URL = "/api/v1/settings"
FOREIGN_ORIGIN = "https://evil.example"


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


async def _select_profile(client: AsyncClient) -> None:
    client.headers["X-Planora-Profile"] = "hamster_knight"


def _seed_task(
    session_factory: sessionmaker[Session], **overrides: Any
) -> uuid.UUID:
    defaults: dict[str, Any] = {
        "title": "Existing task",
        "content": "Existing content",
        "status": TaskStatus.TODO,
        "category": TaskCategory.WORK,
        "priority": TaskPriority.MEDIUM,
        "position": 1.0,
    }
    defaults.update(overrides)
    with session_factory() as session:
        task = Task(**defaults)
        session.add(task)
        session.commit()
        return task.id


# --- GET /api/v1/settings ----------------------------------------------------


def test_get_with_no_row_returns_deployment_defaults_and_creates_no_row(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.get(SETTINGS_URL)

    response = _run(scenario)

    assert response.status_code == 200
    assert response.json() == {
        "timezone": VALID_ENV["DEFAULT_TIMEZONE"],
        "model_name": VALID_ENV["LLM_MODEL"],
        "available_models": [VALID_ENV["LLM_MODEL"]],
    }
    with migrated_session_factory() as session:
        assert session.get(AppSettings, 1) is None


def test_get_response_keys_are_exactly_timezone_model_name_and_available_models(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.get(SETTINGS_URL)

    response = _run(scenario)
    assert set(response.json().keys()) == {"timezone", "model_name", "available_models"}


def test_get_response_never_contains_a_secret_sentinel(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    sentinels = {
        "LLM_API_KEY": "SENTINEL-llm-api-key",
        "SESSION_SECRET": "SENTINEL-session-secret",
        "LLM_BASE_URL": "https://SENTINEL-llm-base-url.example/v1",
    }
    for name, value in sentinels.items():
        valid_env.setenv(name, value)
    database_url_sentinel = "SENTINEL-database-url-fragment"
    # DATABASE_URL must keep pointing at the migrated test database, but we
    # can still assert the *real* configured value never appears — swap in
    # a value containing the sentinel as a query-string-like suffix that
    # SQLite tolerates via a URI-style path is unnecessarily fragile; the
    # meaningful assertion is that the DATABASE_URL environment value
    # itself never leaks, so we assert against its current, already
    # migrated value fetched fresh from settings.
    app = app_factory()
    settings = load_settings()
    assert database_url_sentinel not in settings.database_url  # sanity: not accidentally present

    async def scenario() -> tuple[Response, str]:
        async with make_client(app) as client:
            await _select_profile(client)
            token = "SENTINEL-retired-session-cookie"
            client.cookies.set("planora_session", token)
            response = await client.get(SETTINGS_URL)
            return response, token

    response, token = _run(scenario)

    assert response.status_code == 200
    text = response.text
    for value in sentinels.values():
        assert value not in text
    assert settings.database_url not in text
    assert token not in text


# --- PATCH /api/v1/settings --------------------------------------------------


def test_patch_timezone_only_updates_and_get_agrees(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            patch_response = await client.patch(
                SETTINGS_URL, json={"timezone": "America/New_York"}
            )
            get_response = await client.get(SETTINGS_URL)
            return patch_response, get_response

    patch_response, get_response = _run(scenario)

    assert patch_response.status_code == 200
    assert patch_response.json() == {
        "timezone": "America/New_York",
        "model_name": VALID_ENV["LLM_MODEL"],
        "available_models": [VALID_ENV["LLM_MODEL"]],
    }
    assert get_response.json() == patch_response.json()


def test_patch_model_name_only_leaves_timezone_unchanged(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    valid_env.setenv("LLM_ALLOWED_MODELS", "kimi-k3-turbo")
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            await client.patch(SETTINGS_URL, json={"timezone": "Asia/Tokyo"})
            model_only = await client.patch(SETTINGS_URL, json={"model_name": "kimi-k3-turbo"})
            get_response = await client.get(SETTINGS_URL)
            return model_only, get_response

    model_only, get_response = _run(scenario)

    assert model_only.status_code == 200
    assert model_only.json() == {
        "timezone": "Asia/Tokyo",
        "model_name": "kimi-k3-turbo",
        "available_models": [VALID_ENV["LLM_MODEL"], "kimi-k3-turbo"],
    }
    assert get_response.json() == model_only.json()


def test_patch_timezone_only_leaves_model_name_unchanged(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    valid_env.setenv("LLM_ALLOWED_MODELS", "kimi-k3-turbo")
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            await client.patch(SETTINGS_URL, json={"model_name": "kimi-k3-turbo"})
            return await client.patch(SETTINGS_URL, json={"timezone": "Asia/Tokyo"})

    response = _run(scenario)

    assert response.status_code == 200
    assert response.json() == {
        "timezone": "Asia/Tokyo",
        "model_name": "kimi-k3-turbo",
        "available_models": [VALID_ENV["LLM_MODEL"], "kimi-k3-turbo"],
    }


def test_patch_unset_field_keeps_following_the_deployment_value_on_restart(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def set_timezone_only() -> None:
        async with make_client(app) as client:
            await _select_profile(client)
            response = await client.patch(SETTINGS_URL, json={"timezone": "Asia/Tokyo"})
            assert response.status_code == 200

    _run(set_timezone_only)

    # A new app instance started with a different LLM_MODEL — the field
    # the user never set keeps following the (now-different) deployment
    # value, since no override was ever stored for it.
    valid_env.setenv("LLM_MODEL", "a-different-model")
    app2 = app_factory()

    async def read_again() -> Response:
        async with make_client(app2) as client:
            await _select_profile(client)
            return await client.get(SETTINGS_URL)

    response = _run(read_again)
    assert response.status_code == 200
    assert response.json() == {
        "timezone": "Asia/Tokyo",
        "model_name": "a-different-model",
        "available_models": ["a-different-model"],
    }


def test_patch_empty_body_returns_current_settings_and_changes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            first = await client.patch(SETTINGS_URL, json={"timezone": "Asia/Tokyo"})
            empty = await client.patch(SETTINGS_URL, json={})
            return first, empty

    first, empty = _run(scenario)

    assert empty.status_code == 200
    assert empty.json() == first.json()

    with migrated_session_factory() as session:
        row = session.get(AppSettings, 1)
        assert row is not None
        updated_at_after_first = row.updated_at

    # A second empty PATCH must not bump updated_at either.
    async def second_empty() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(SETTINGS_URL, json={})

    _run(second_empty)
    with migrated_session_factory() as session:
        row = session.get(AppSettings, 1)
        assert row is not None
        assert row.updated_at == updated_at_after_first


def test_patch_empty_body_creates_no_row_when_none_existed(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(SETTINGS_URL, json={})

    response = _run(scenario)
    assert response.status_code == 200

    with migrated_session_factory() as session:
        assert session.get(AppSettings, 1) is None


@pytest.mark.parametrize(
    "timezone", ["Asia/Singapore", "UTC", "America/New_York"]
)
def test_patch_accepts_valid_iana_timezones(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
    timezone: str,
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(SETTINGS_URL, json={"timezone": timezone})

    response = _run(scenario)
    assert response.status_code == 200
    assert response.json()["timezone"] == timezone


@pytest.mark.parametrize(
    "timezone",
    ["Mars/Olympus", "asia/singapore", "", "+08:00", "../etc/passwd", None],
)
def test_patch_rejects_invalid_timezones(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
    timezone: str | None,
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            await client.patch(SETTINGS_URL, json={"timezone": "Asia/Tokyo"})
            invalid = await client.patch(SETTINGS_URL, json={"timezone": timezone})
            after = await client.get(SETTINGS_URL)
            return invalid, after

    invalid, after = _run(scenario)

    assert invalid.status_code == 422
    assert invalid.json()["code"] == "VALIDATION_ERROR"
    fields = {detail["field"] for detail in invalid.json()["details"]}
    assert "timezone" in fields
    assert after.json()["timezone"] == "Asia/Tokyo"


@pytest.mark.parametrize(
    "model_name",
    ["", "   ", "x" * 201, "bad\nname", None],
)
def test_patch_rejects_invalid_model_names(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
    model_name: str | None,
) -> None:
    valid_env.setenv("LLM_ALLOWED_MODELS", "kimi-k3-turbo")
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            await client.patch(SETTINGS_URL, json={"model_name": "kimi-k3-turbo"})
            invalid = await client.patch(SETTINGS_URL, json={"model_name": model_name})
            after = await client.get(SETTINGS_URL)
            return invalid, after

    invalid, after = _run(scenario)

    assert invalid.status_code == 422
    assert invalid.json()["code"] == "VALIDATION_ERROR"
    fields = {detail["field"] for detail in invalid.json()["details"]}
    assert "model_name" in fields
    assert after.json()["model_name"] == "kimi-k3-turbo"


def test_patch_strips_surrounding_whitespace_from_model_name(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    valid_env.setenv("LLM_ALLOWED_MODELS", "kimi-k3")
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(SETTINGS_URL, json={"model_name": "  kimi-k3  "})

    response = _run(scenario)
    assert response.status_code == 200
    assert response.json()["model_name"] == "kimi-k3"


@pytest.mark.parametrize(
    "body",
    [
        {"llm_api_key": "sk-new"},
        {"database_url": "sqlite:///x.db"},
        {"llm_base_url": "https://evil.example"},
        {"session_secret": "new-secret"},
        {"password": "new-password"},
        {"unknown_field": "value"},
    ],
)
def test_patch_rejects_fields_outside_the_settings_contract(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
    body: dict[str, str],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            invalid = await client.patch(SETTINGS_URL, json=body)
            after = await client.get(SETTINGS_URL)
            return invalid, after

    invalid, after = _run(scenario)

    assert invalid.status_code == 422
    assert invalid.json()["code"] == "VALIDATION_ERROR"
    assert after.json() == {
        "timezone": VALID_ENV["DEFAULT_TIMEZONE"],
        "model_name": VALID_ENV["LLM_MODEL"],
        "available_models": [VALID_ENV["LLM_MODEL"]],
    }


def test_patch_is_atomic_valid_timezone_with_invalid_model_name_persists_neither(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            invalid = await client.patch(
                SETTINGS_URL, json={"timezone": "America/New_York", "model_name": ""}
            )
            after = await client.get(SETTINGS_URL)
            return invalid, after

    invalid, after = _run(scenario)

    assert invalid.status_code == 422
    assert after.json() == {
        "timezone": VALID_ENV["DEFAULT_TIMEZONE"],
        "model_name": VALID_ENV["LLM_MODEL"],
        "available_models": [VALID_ENV["LLM_MODEL"]],
    }


def test_patch_timezone_does_not_change_a_stored_deadline_instant(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    deadline = datetime(2026, 10, 1, 9, 0, 0, tzinfo=UTC)
    task_id = _seed_task(migrated_session_factory, deadline_at=deadline)
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            before = await client.get(f"/api/v1/tasks/{task_id}")
            patch_response = await client.patch(
                SETTINGS_URL, json={"timezone": "America/New_York"}
            )
            assert patch_response.status_code == 200
            after = await client.get(f"/api/v1/tasks/{task_id}")
            return before, after

    before, after = _run(scenario)

    assert before.status_code == 200
    assert after.status_code == 200
    assert before.json()["deadline_at"] == after.json()["deadline_at"]


def test_get_effective_settings_resolves_override_else_deployment_default(
    valid_env: pytest.MonkeyPatch,
    migrated_session_factory: sessionmaker[Session],
) -> None:
    valid_env.setenv("LLM_ALLOWED_MODELS", "custom-model")
    settings = load_settings()
    with migrated_session_factory() as session:
        no_override = get_effective_settings(session, settings)
        assert no_override.timezone == settings.default_timezone
        assert no_override.model_name == settings.llm_model

    with migrated_session_factory() as session:
        update_app_settings(
            session, now=datetime.now(UTC), timezone="Asia/Tokyo", model_name="custom-model"
        )
        session.commit()

    with migrated_session_factory() as session:
        overridden = get_effective_settings(session, settings)
        assert overridden.timezone == "Asia/Tokyo"
        assert overridden.model_name == "custom-model"


# --- Model allow-list (issue #86) -------------------------------------------


def _get(app: FastAPI) -> Response:
    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.get(SETTINGS_URL)

    return _run(scenario)


def test_available_models_are_default_first_then_trimmed_deduped_allow_list(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    valid_env.setenv("LLM_MODEL", "kimi-k3")
    valid_env.setenv("LLM_ALLOWED_MODELS", " kimi-k3-thinking , ,kimi-k3")
    response = _get(app_factory())
    assert response.status_code == 200
    assert response.json()["available_models"] == ["kimi-k3", "kimi-k3-thinking"]


def test_unset_allow_list_offers_only_the_deployment_model(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    valid_env.setenv("LLM_MODEL", "kimi-k3")
    assert _get(app_factory()).json()["available_models"] == ["kimi-k3"]


def test_patch_response_carries_available_models(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    valid_env.setenv("LLM_ALLOWED_MODELS", "other-model")
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(SETTINGS_URL, json={"model_name": "other-model"})

    response = _run(scenario)
    assert response.status_code == 200
    assert response.json() == {
        "timezone": VALID_ENV["DEFAULT_TIMEZONE"],
        "model_name": "other-model",
        "available_models": [VALID_ENV["LLM_MODEL"], "other-model"],
    }


def test_patch_rejects_a_model_the_deployment_does_not_serve_and_stores_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    valid_env.setenv("LLM_MODEL", "kimi-k3")
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            await _select_profile(client)
            rejected = await client.patch(
                SETTINGS_URL, json={"timezone": "Asia/Tokyo", "model_name": " planora-pro "}
            )
            after = await client.get(SETTINGS_URL)
            return rejected, after

    rejected, after = _run(scenario)

    assert rejected.status_code == 422
    body = rejected.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert [d["field"] for d in body["details"]] == ["model_name"]
    assert after.json()["model_name"] == "kimi-k3"
    assert after.json()["timezone"] == VALID_ENV["DEFAULT_TIMEZONE"]
    with migrated_session_factory() as session:
        assert session.get(AppSettings, 1) is None


def test_patch_rejects_available_models_in_the_body(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.patch(SETTINGS_URL, json={"available_models": ["x"]})

    response = _run(scenario)
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_stored_override_no_longer_allowed_falls_back_to_llm_model(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: sessionmaker[Session],
    app_factory: Callable[[], FastAPI],
) -> None:
    valid_env.setenv("LLM_MODEL", "kimi-k3")
    valid_env.setenv("LLM_ALLOWED_MODELS", "kimi-k3-thinking")
    app = app_factory()

    async def choose() -> None:
        async with make_client(app) as client:
            await _select_profile(client)
            response = await client.patch(SETTINGS_URL, json={"model_name": "kimi-k3-thinking"})
            assert response.status_code == 200
            assert response.json()["model_name"] == "kimi-k3-thinking"

    _run(choose)

    # The deployment restarts with the allow-list removed.
    valid_env.delenv("LLM_ALLOWED_MODELS")
    response = _get(app_factory())
    assert response.json()["model_name"] == "kimi-k3"
    assert response.json()["available_models"] == ["kimi-k3"]

    with migrated_session_factory() as session:
        effective = get_effective_settings(session, load_settings())
        assert effective.model_name == "kimi-k3"


# --- Security and contract ---------------------------------------------------


def test_get_and_patch_require_authentication(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:
            get_response = await client.get(SETTINGS_URL)
            patch_response = await client.patch(SETTINGS_URL, json={"timezone": "Asia/Tokyo"})
            return get_response, patch_response

    get_response, patch_response = _run(scenario)

    assert get_response.status_code == 422
    assert get_response.json()["code"] == "VALIDATION_ERROR"
    assert patch_response.status_code == 422
    assert patch_response.json()["code"] == "VALIDATION_ERROR"


def test_patch_rejects_a_mismatched_origin_and_changes_nothing(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def cross_origin_patch() -> tuple[Response, Response]:
        async with make_client(app, origin=FOREIGN_ORIGIN) as client:
            await _select_profile(client)
            patch_response = await client.patch(SETTINGS_URL, json={"timezone": "Asia/Tokyo"})
            return patch_response, patch_response

    patch_response, _ = _run(cross_origin_patch)
    assert patch_response.status_code == 403
    assert patch_response.json()["code"] == "CSRF_ORIGIN_MISMATCH"

    async def same_origin_get() -> Response:
        async with make_client(app) as client:
            await _select_profile(client)
            return await client.get(SETTINGS_URL)

    after = _run(same_origin_get)
    assert after.json() == {
        "timezone": VALID_ENV["DEFAULT_TIMEZONE"],
        "model_name": VALID_ENV["LLM_MODEL"],
        "available_models": [VALID_ENV["LLM_MODEL"]],
    }


def test_get_settings_is_not_origin_checked(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def cross_origin_get() -> Response:
        async with make_client(app, origin=FOREIGN_ORIGIN) as client:
            await _select_profile(client)
            return await client.get(SETTINGS_URL)

    response = _run(cross_origin_get)
    assert response.status_code == 200
