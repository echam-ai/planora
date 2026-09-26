"""Integration tests for `CSRFOriginMiddleware` (issue #26).

Uses the HTTPX `AsyncClient` against the real ASGI app, exactly like
`tests/integration/test_health.py` — no browser needed.
`tests/conftest.py`'s `make_client` sends the suite's configured
`APP_ORIGIN` (`conftest.DEFAULT_ORIGIN`, `https://planora.example`) as the
`Origin` header by default; each test below overrides it explicitly to
exercise the check itself.

A throwaway router with one route per unsafe method is mounted on the app
`create_app()` returns (the same pattern `test_auth_session_logout.py` and
`test_get_db_transaction_semantics.py` use for `require_session` and
`get_db`) so this file doesn't need a real business route to prove the
middleware runs — and, separately, doesn't rely on any router that could
change shape later.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from conftest import AUTH_PASSWORD, AUTH_USERNAME, DEFAULT_ORIGIN, make_client
from fastapi import APIRouter, FastAPI
from httpx import Response
from sqlalchemy import select

from planora_api.db.models import LoginFailure

FOREIGN_ORIGIN = "https://evil.example"

NEAR_MISS_ORIGINS = [
    "http://planora.example",  # scheme
    "https://planora.example:8443",  # port
    "https://app.planora.example",  # subdomain
    "https://planora.example.evil.example",  # suffix
    "https://planora.example/",  # trailing slash
    "https://PLANORA.example",  # case
    "https://planora.example, https://evil.example",  # list
]


def _run(coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    return asyncio.run(coro_fn())


_test_router = APIRouter()
_call_counts: dict[str, int] = {"POST": 0, "PUT": 0, "PATCH": 0, "DELETE": 0}


def _reset_call_counts() -> None:
    for method in _call_counts:
        _call_counts[method] = 0


@_test_router.post("/api/v1/__test_only/csrf")
def _post_handler() -> dict[str, str]:
    _call_counts["POST"] += 1
    return {"method": "POST"}


@_test_router.put("/api/v1/__test_only/csrf")
def _put_handler() -> dict[str, str]:
    _call_counts["PUT"] += 1
    return {"method": "PUT"}


@_test_router.patch("/api/v1/__test_only/csrf")
def _patch_handler() -> dict[str, str]:
    _call_counts["PATCH"] += 1
    return {"method": "PATCH"}


@_test_router.delete("/api/v1/__test_only/csrf")
def _delete_handler() -> dict[str, str]:
    _call_counts["DELETE"] += 1
    return {"method": "DELETE"}


def _mounted_app(app_factory: Callable[[], FastAPI]) -> FastAPI:
    app = app_factory()
    app.include_router(_test_router)
    return app


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_allowed_origin_reaches_the_handler(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    method: str,
) -> None:
    _reset_call_counts()
    app = _mounted_app(app_factory)

    async def scenario() -> Response:
        async with make_client(app) as client:  # default Origin == APP_ORIGIN
            return await client.request(method, "/api/v1/__test_only/csrf")

    response = _run(scenario)

    assert response.status_code == 200
    assert response.json() == {"method": method}
    assert _call_counts[method] == 1


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_foreign_origin_returns_403_and_never_calls_the_handler(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    method: str,
) -> None:
    _reset_call_counts()
    app = _mounted_app(app_factory)

    async def scenario() -> Response:
        async with make_client(app, origin=FOREIGN_ORIGIN) as client:
            return await client.request(method, "/api/v1/__test_only/csrf")

    response = _run(scenario)

    assert response.status_code == 403
    assert response.json() == {
        "code": "CSRF_ORIGIN_MISMATCH",
        "message": "This request did not come from Planora.",
    }
    assert _call_counts[method] == 0


def test_missing_origin_returns_403_with_no_referer_fallback(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    _reset_call_counts()
    app = _mounted_app(app_factory)

    async def scenario() -> Response:
        async with make_client(app, origin=None) as client:
            return await client.post(
                "/api/v1/__test_only/csrf",
                headers={"Referer": "https://planora.example/"},
            )

    response = _run(scenario)

    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"
    assert _call_counts["POST"] == 0


def test_origin_null_returns_403(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    _reset_call_counts()
    app = _mounted_app(app_factory)

    async def scenario() -> Response:
        async with make_client(app, origin="null") as client:
            return await client.post("/api/v1/__test_only/csrf")

    response = _run(scenario)

    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"
    assert _call_counts["POST"] == 0


@pytest.mark.parametrize("origin", NEAR_MISS_ORIGINS)
def test_near_miss_origins_return_403(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI], origin: str
) -> None:
    _reset_call_counts()
    app = _mounted_app(app_factory)

    async def scenario() -> Response:
        async with make_client(app, origin=origin) as client:
            return await client.post("/api/v1/__test_only/csrf")

    response = _run(scenario)

    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"
    assert _call_counts["POST"] == 0


@pytest.mark.parametrize(
    "origins",
    [
        [DEFAULT_ORIGIN, FOREIGN_ORIGIN],
        [FOREIGN_ORIGIN, DEFAULT_ORIGIN],
    ],
)
def test_duplicate_origin_header_lines_return_403_in_either_order(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    origins: list[str],
) -> None:
    _reset_call_counts()
    app = _mounted_app(app_factory)

    async def scenario() -> Response:
        async with make_client(app, origin=None) as client:
            return await client.post(
                "/api/v1/__test_only/csrf",
                headers=[("Origin", origins[0]), ("Origin", origins[1])],
            )

    response = _run(scenario)

    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"
    assert _call_counts["POST"] == 0


def test_loosely_configured_origin_normalizes_scheme_and_host_case_and_default_port(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    valid_env.setenv("APP_ORIGIN", "https://Planora.Example:443")
    _reset_call_counts()
    app = _mounted_app(app_factory)

    async def scenario() -> Response:
        async with make_client(app, origin="https://planora.example") as client:
            return await client.post("/api/v1/__test_only/csrf")

    response = _run(scenario)

    assert response.status_code == 200
    assert _call_counts["POST"] == 1


@pytest.mark.parametrize(
    ("origin", "expect_pass"),
    [
        ("http://localhost:3000", True),
        ("http://127.0.0.1:3000", False),
        ("http://localhost:5173", False),
    ],
)
def test_localhost_dev_origin_is_distinct_from_127_0_0_1_and_other_ports(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    origin: str,
    expect_pass: bool,
) -> None:
    valid_env.setenv("APP_ORIGIN", "http://localhost:3000")
    _reset_call_counts()
    app = _mounted_app(app_factory)

    async def scenario() -> Response:
        async with make_client(app, origin=origin) as client:
            return await client.post("/api/v1/__test_only/csrf")

    response = _run(scenario)

    assert response.status_code == (200 if expect_pass else 403)


def test_check_reads_only_app_origin_not_host_or_x_forwarded_host(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    # Origin, Host and X-Forwarded-Host are all the foreign host — if the
    # middleware derived its expected value from either of the latter two
    # instead of APP_ORIGIN, this would incorrectly pass.
    _reset_call_counts()
    app = _mounted_app(app_factory)

    async def scenario() -> Response:
        async with make_client(app, origin=FOREIGN_ORIGIN) as client:
            return await client.post(
                "/api/v1/__test_only/csrf",
                headers={"Host": "evil.example", "X-Forwarded-Host": "evil.example"},
            )

    response = _run(scenario)

    assert response.status_code == 403
    assert _call_counts["POST"] == 0


@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
@pytest.mark.parametrize("origin", [FOREIGN_ORIGIN, None])
def test_safe_methods_bypass_the_check(
    valid_env: pytest.MonkeyPatch,
    app_factory: Callable[[], FastAPI],
    method: str,
    origin: str | None,
) -> None:
    app = _mounted_app(app_factory)

    async def scenario() -> Response:
        async with make_client(app, origin=origin) as client:
            return await client.request(method, "/api/v1/__test_only/csrf")

    response = _run(scenario)

    # A plain GET/HEAD/OPTIONS on this test-only route 404s (no handler is
    # registered for those methods on this path) — the point is that it is
    # never the middleware's 403, i.e. routing was reached.
    assert response.status_code != 403


@pytest.mark.parametrize("origin", [FOREIGN_ORIGIN, None])
def test_health_ignores_origin_and_still_returns_200(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI], origin: str | None
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app, origin=origin) as client:
            return await client.get("/api/v1/health")

    response = _run(scenario)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_check_precedes_body_parsing_malformed_json_returns_403_not_422(
    valid_env: pytest.MonkeyPatch, app_factory: Callable[[], FastAPI]
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app, origin=FOREIGN_ORIGIN) as client:
            return await client.post(
                "/api/v1/auth/login",
                content=b"{not valid json",
                headers={"Content-Type": "application/json"},
            )

    response = _run(scenario)

    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"


# --- Conditional on #25 (login/logout) being on main ------------------------


def test_forged_login_is_refused_before_credentials_are_checked(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    migrated_session_factory: object,
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> Response:
        async with make_client(app, origin=FOREIGN_ORIGIN) as client:
            return await client.post(
                "/api/v1/auth/login",
                json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD},
            )

    response = _run(scenario)

    assert response.status_code == 403
    assert response.json()["code"] == "CSRF_ORIGIN_MISMATCH"
    assert "set-cookie" not in response.headers

    with migrated_session_factory() as session:  # type: ignore[operator]
        failures = session.execute(select(LoginFailure)).scalars().all()
    assert failures == []


def test_forged_logout_is_refused_and_the_session_survives(
    valid_env: pytest.MonkeyPatch,
    seeded_user: tuple[str, str],
    app_factory: Callable[[], FastAPI],
) -> None:
    app = app_factory()

    async def scenario() -> tuple[Response, Response]:
        async with make_client(app) as client:  # correct origin to sign in
            login_response = await client.post(
                "/api/v1/auth/login",
                json={"username": AUTH_USERNAME, "password": AUTH_PASSWORD},
            )
            assert login_response.status_code == 200
            cookie = client.cookies.get("planora_session")

        async with make_client(app, origin=FOREIGN_ORIGIN) as forged_client:
            forged_client.cookies.set("planora_session", cookie)
            logout_response = await forged_client.post("/api/v1/auth/logout")

        async with make_client(app) as client:  # safe GET, any origin would do
            client.cookies.set("planora_session", cookie)
            session_response = await client.get("/api/v1/auth/session")

        return logout_response, session_response

    logout_response, session_response = _run(scenario)

    assert logout_response.status_code == 403
    assert logout_response.json()["code"] == "CSRF_ORIGIN_MISMATCH"
    assert session_response.status_code == 200
    assert session_response.json() is not None
    assert session_response.json()["username"] == AUTH_USERNAME


def test_default_origin_constant_matches_valid_env() -> None:
    # Guards against the fixture and this file's constant drifting apart.
    assert DEFAULT_ORIGIN == "https://planora.example"
