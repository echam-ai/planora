"""Every `/api/v1` data route is behind the site password (issue #124).

Covers AC8-AC10. The route list is read from the app itself, so a route added
later is covered without editing this file.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

import pytest
from conftest import make_client, valid_access_token
from sqlalchemy import func, select

from planora_api.ai.deps import get_llm_client
from planora_api.ai.fake import FakeLLMClient
from planora_api.db.models import ChatAction, ChatMessage, Task
from planora_api.openapi import build_schema

PROFILE_HEADER = {"X-Planora-Profile": "hamster_knight"}
_PUBLIC = re.compile(r"^/api/v1/(health|auth/.*)$")
_BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _gated_operations() -> list[tuple[str, str]]:
    operations = []
    for path, methods in build_schema()["paths"].items():
        if not path.startswith("/api/v1/") or _PUBLIC.match(path):
            continue
        for method in methods:
            operations.append((method.upper(), re.sub(r"\{[^}]+\}", "1", path)))
    return sorted(operations)


GATED = _gated_operations()


def test_the_route_list_covers_every_data_area() -> None:
    paths = {path for _, path in GATED}
    assert {
        "/api/v1/profiles",
        "/api/v1/tasks",
        "/api/v1/tasks/1/move",
        "/api/v1/archive",
        "/api/v1/archive/1/restore",
        "/api/v1/settings",
        "/api/v1/ai/parse-task",
        "/api/v1/chat/conversation",
        "/api/v1/chat/messages",
    } <= paths
    assert len(GATED) >= 15


@pytest.fixture
def app(valid_env, app_factory):
    return app_factory()


@pytest.mark.parametrize(("method", "path"), GATED)
@pytest.mark.parametrize("cookie", [None, "garbage", "v1.9999999999.AAAA"])
@pytest.mark.parametrize("with_profile", [True, False])
def test_every_gated_route_returns_401(app, method, path, cookie, with_profile) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            if cookie:
                client.cookies.set("planora_access", cookie)
            kwargs: dict[str, Any] = {"headers": PROFILE_HEADER if with_profile else {}}
            if method in _BODY_METHODS:
                kwargs["json"] = {}
            response = await client.request(method, path, **kwargs)
            assert response.status_code == 401, response.text
            assert response.json() == {
                "code": "NOT_AUTHENTICATED",
                "message": "Authentication is required.",
            }
            assert "set-cookie" not in response.headers

    asyncio.run(scenario())


def test_a_malformed_json_body_is_still_401_not_422(app) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            response = await client.post(
                "/api/v1/ai/parse-task",
                content=b"{not json",
                headers={**PROFILE_HEADER, "Content-Type": "application/json"},
            )
            assert response.status_code == 401

    asyncio.run(scenario())


def test_unknown_api_paths_are_gated_too(app) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            assert (await client.get("/api/v1/does-not-exist")).status_code == 401

    asyncio.run(scenario())


def test_a_tampered_but_wellformed_cookie_is_rejected(app) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            token = valid_access_token(app)
            client.cookies.set("planora_access", token[:-2] + ("AA" if token[-2:] != "AA" else "BB"))
            assert (await client.get("/api/v1/profiles")).status_code == 401

    asyncio.run(scenario())


def test_a_valid_cookie_reaches_routes_and_profile_validation_still_applies(app) -> None:
    async def scenario() -> None:
        async with make_client(app) as client:
            assert (await client.get("/api/v1/profiles")).status_code == 200
            response = await client.get("/api/v1/tasks")
            assert response.status_code == 422
            assert response.json()["code"] == "VALIDATION_ERROR"
            response = await client.get("/api/v1/tasks", headers={"X-Planora-Profile": "nobody"})
            assert response.status_code == 422

    asyncio.run(scenario())


def test_a_foreign_origin_write_is_still_rejected_by_csrf_first(app) -> None:
    async def scenario() -> None:
        async with make_client(app, authenticated=False, origin="https://evil.example") as client:
            response = await client.post("/api/v1/tasks", json={}, headers=PROFILE_HEADER)
            assert response.status_code == 403
            assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"

    asyncio.run(scenario())


def test_unauthenticated_ai_calls_never_reach_the_llm_or_write(
    migrated_session_factory, app_factory
) -> None:
    app = app_factory()
    fake = FakeLLMClient([])
    app.dependency_overrides[get_llm_client] = lambda: fake

    def counts() -> tuple[int, int, int]:
        with migrated_session_factory() as db:
            return tuple(  # type: ignore[return-value]
                db.scalar(select(func.count()).select_from(model)) for model in (Task, ChatMessage, ChatAction)
            )

    before = counts()

    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            for path, body in (
                ("/api/v1/ai/parse-task", {"text": "buy milk tomorrow"}),
                ("/api/v1/chat/messages", {"text": "create a task"}),
            ):
                response = await client.post(path, json=body, headers=PROFILE_HEADER)
                assert response.status_code == 401
                assert response.json()["code"] == "NOT_AUTHENTICATED"

    asyncio.run(scenario())
    assert fake.calls == []
    assert counts() == before


def test_only_api_v1_is_gated_not_the_generated_docs_schema(app) -> None:
    """Pins the scope: `/api/v1/*` minus health and auth. FastAPI's own
    `/openapi.json` (route metadata only, no data) is outside it."""
    async def scenario() -> None:
        async with make_client(app, authenticated=False) as client:
            assert (await client.get("/openapi.json")).status_code == 200

    asyncio.run(scenario())
