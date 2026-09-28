"""Schema-walking contract tests for issue #34 (from #27's acceptance
note): every mutating operation documents the `403` CSRF middleware
(#26) can return, every `require_session`-guarded operation documents
`401`, and the impossible statuses #27 flagged are gone.

Rule-based, not enumerated by route name, so a future route (AI parsing
#38, chat #39-#41) is covered automatically: a new `POST`/`PUT`/`PATCH`/
`DELETE` route with no documented `403`, or a new `require_session` route
with no documented `401`, fails one of these tests without anyone having
to remember to update it.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, BaseRoute, _IncludedRouter

from planora_api.api.deps import require_session
from planora_api.main import create_app

_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _iter_dependants(dependant: Dependant) -> Iterator[Dependant]:
    yield dependant
    for sub in dependant.dependencies:
        yield from _iter_dependants(sub)


def _iter_api_routes(routes: list[BaseRoute]) -> Iterator[APIRoute]:
    """Every real `APIRoute` reachable from `routes`, unwrapping FastAPI's
    lazy `_IncludedRouter` wrapper — same technique as
    `test_db_dependency_scope.py`."""
    for route in routes:
        if isinstance(route, _IncludedRouter):
            yield from _iter_api_routes(route.original_router.routes)
        elif isinstance(route, APIRoute):
            yield route


def _requires_session(route: APIRoute) -> bool:
    return any(d.call is require_session for d in _iter_dependants(route.dependant))


@pytest.fixture
def app(valid_env: pytest.MonkeyPatch) -> Iterator[FastAPI]:
    built = create_app()
    try:
        yield built
    finally:
        built.state.session_factory.kw["bind"].dispose()


def _operations(app: FastAPI) -> Iterator[tuple[str, str, dict]]:
    """Every `(path, method, operation)` in the exported schema, `method`
    upper-cased."""
    for path, methods in app.openapi()["paths"].items():
        for method, operation in methods.items():
            if method.upper() not in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}:
                continue  # skip non-HTTP-method keys openapi paths may carry
            yield path, method.upper(), operation


def _envelope_ref(operation: dict, status: str) -> str | None:
    response = operation.get("responses", {}).get(status)
    if response is None:
        return None
    try:
        return response["content"]["application/json"]["schema"]["$ref"]
    except KeyError:
        return None


# --- Every mutating operation documents 403 (#26's CSRF middleware) -------


def test_every_mutating_operation_documents_403(app: FastAPI) -> None:
    missing = [
        f"{method} {path}"
        for path, method, operation in _operations(app)
        if method in _MUTATING_METHODS and "403" not in operation.get("responses", {})
    ]
    assert not missing, f"missing documented 403 (CSRF_ORIGIN_MISMATCH): {missing}"


def test_every_mutating_operation_documents_403_non_vacuously(app: FastAPI) -> None:
    mutating = [
        f"{method} {path}" for path, method, operation in _operations(app) if method in _MUTATING_METHODS
    ]
    assert mutating, "expected at least one mutating operation — the walk found none"


def test_every_documented_403_uses_the_error_envelope(app: FastAPI) -> None:
    bad = [
        f"{method} {path}"
        for path, method, operation in _operations(app)
        if (ref := _envelope_ref(operation, "403")) is not None and not ref.endswith("/ErrorResponse")
    ]
    assert not bad, f"403 not documented with ErrorResponse: {bad}"


# --- Every require_session route documents 401 -----------------------------


def _session_guarded_operations(app: FastAPI) -> set[tuple[str, str]]:
    guarded: set[tuple[str, str]] = set()
    for route in _iter_api_routes(app.routes):
        if not _requires_session(route):
            continue
        for method in route.methods or set():
            if method in {"HEAD", "OPTIONS"}:
                continue
            guarded.add((route.path, method))
    return guarded


def test_every_require_session_route_documents_401(app: FastAPI) -> None:
    guarded = _session_guarded_operations(app)
    assert guarded, "expected at least one require_session route — the walk found none"

    missing = []
    for path, method, operation in _operations(app):
        if (path, method) not in guarded:
            continue
        if "401" not in operation.get("responses", {}):
            missing.append(f"{method} {path}")
    assert not missing, f"missing documented 401 (NOT_AUTHENTICATED): {missing}"


def test_every_documented_401_uses_the_error_envelope(app: FastAPI) -> None:
    bad = [
        f"{method} {path}"
        for path, method, operation in _operations(app)
        if (ref := _envelope_ref(operation, "401")) is not None and not ref.endswith("/ErrorResponse")
    ]
    assert not bad, f"401 not documented with ErrorResponse: {bad}"


# --- Impossible statuses removed (#27's acceptance note) -------------------


def test_health_documents_only_200(app: FastAPI) -> None:
    responses = app.openapi()["paths"]["/api/v1/health"]["get"]["responses"]
    assert "200" in responses
    assert "422" not in responses
    assert "404" not in responses
    assert "405" not in responses


def test_logout_documents_neither_401_nor_429(app: FastAPI) -> None:
    responses = app.openapi()["paths"]["/api/v1/auth/logout"]["post"]["responses"]
    assert "401" not in responses
    assert "429" not in responses


def test_session_read_documents_neither_401_nor_429(app: FastAPI) -> None:
    responses = app.openapi()["paths"]["/api/v1/auth/session"]["get"]["responses"]
    assert "401" not in responses
    assert "429" not in responses


def test_login_keeps_401_422_and_429(app: FastAPI) -> None:
    responses = app.openapi()["paths"]["/api/v1/auth/login"]["post"]["responses"]
    assert "401" in responses
    assert "422" in responses
    assert "429" in responses


def test_error_response_and_validation_envelope_still_registered(app: FastAPI) -> None:
    schemas = app.openapi()["components"]["schemas"]
    assert "ErrorResponse" in schemas
    assert "ValidationErrorDetail" in schemas
