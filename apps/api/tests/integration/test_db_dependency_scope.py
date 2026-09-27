"""Enforces issue #80's dynamic guard: every route FastAPI actually builds
must reach `get_db` with `scope="function"`, however many dependencies
deep.

`tests/unit/test_db_dependency_scope.py` catches a direct
`Depends(get_db, ...)` written in the wrong shape by scanning source text.
It cannot catch an *indirect* regression — e.g. a new shared dependency
that itself calls `Depends(get_db)` correctly-shaped but wrongly scoped, or
a future helper that re-wraps `get_db` under a different name FastAPI still
resolves to the same callable. This test instead walks the real dependency
graph FastAPI builds for `create_app()` (`route.dependant`, recursed
through `.dependencies`) and inspects the resolved `Dependant.scope` for
every place `get_db` itself is reached — the same graph FastAPI uses at
request time, not a static approximation of it.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, BaseRoute, _IncludedRouter
from sqlalchemy.orm import Session

from planora_api.api.deps import get_db
from planora_api.main import create_app


def _iter_dependants(dependant: Dependant) -> Iterator[Dependant]:
    yield dependant
    for sub in dependant.dependencies:
        yield from _iter_dependants(sub)


def _iter_api_routes(routes: list[BaseRoute]) -> Iterator[APIRoute]:
    """Every real `APIRoute` reachable from `routes`, unwrapping FastAPI's
    lazy `_IncludedRouter` wrapper that `app.include_router(...)` leaves in
    `app.routes` instead of flattening the included router's own routes in
    place. `original_router.routes` holds those real `APIRoute` objects,
    each already carrying the `.dependant` FastAPI built for it at
    definition time — recursed because an included router can itself
    include another."""
    for route in routes:
        if isinstance(route, _IncludedRouter):
            yield from _iter_api_routes(route.original_router.routes)
        elif isinstance(route, APIRoute):
            yield route


def _get_db_dependants(app: FastAPI) -> list[Dependant]:
    """Every `Dependant` node, across every route on `app`, whose `.call`
    resolves to `get_db` itself — found however deep in that route's
    dependency tree (a route depending on `require_session`, which depends
    on `get_current_session`, which depends on `get_db`, still surfaces
    here)."""
    found: list[Dependant] = []
    for route in _iter_api_routes(app.routes):
        for dependant in _iter_dependants(route.dependant):
            if dependant.call is get_db:
                found.append(dependant)
    return found


def test_every_route_reaches_get_db_only_with_function_scope(
    valid_env: pytest.MonkeyPatch,
) -> None:
    app = create_app()
    try:
        get_db_dependants = _get_db_dependants(app)

        # Non-vacuous: the walk must have actually reached get_db somewhere
        # (through the auth routes' require_session/get_current_session
        # chain) — a walker that silently visited nothing would pass this
        # test for the wrong reason.
        assert get_db_dependants, (
            "expected at least one route on create_app() to reach get_db, "
            "found none — the dependency walk itself is broken"
        )

        wrongly_scoped = [d.scope for d in get_db_dependants if d.scope != "function"]
        assert not wrongly_scoped, (
            f"route(s) reach get_db with scope(s) {wrongly_scoped!r} instead "
            'of "function" — a failed commit there would surface after the '
            "response is already on the wire (see get_db's docstring)"
        )
    finally:
        app.state.session_factory.kw["bind"].dispose()


def test_dependency_walk_fails_on_a_route_with_plain_depends_get_db() -> None:
    """Proves the walk above isn't vacuously green: a throwaway app with a
    single route that writes a bare `Depends(get_db)` (the exact regression
    #80 guards against) must be flagged."""
    app = FastAPI()
    router = APIRouter()

    @router.get("/__test_only/unscoped")
    def unscoped_endpoint(db: Annotated[Session, Depends(get_db)]) -> None:
        raise AssertionError("never called — only the dependant graph matters")

    app.include_router(router)

    get_db_dependants = _get_db_dependants(app)

    assert get_db_dependants, (
        "expected the walk to find the injected route's get_db dependant"
    )
    wrongly_scoped = [d.scope for d in get_db_dependants if d.scope != "function"]
    assert wrongly_scoped, (
        "expected the walk to flag the plain Depends(get_db) as not "
        'scope="function", but it found none'
    )
