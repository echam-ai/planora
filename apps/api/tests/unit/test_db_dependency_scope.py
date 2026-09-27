"""Enforces issue #80's static guard: every `Depends(get_db, ...)` call
under `src/planora_api` must be the single `DbSession` alias definition in
`api/deps.py` — `DbSession = Annotated[Session, Depends(get_db,
scope="function")]` — and nothing else.

#25 made every call site pass `scope="function"` by convention and
documented the contract in `get_db`'s docstring, but nothing enforced it
mechanically. A future endpoint that writes a plain `Depends(get_db)`
(default request scope, see `get_db`'s docstring) silently regresses: its
commit runs *after* the response is already on the wire, so a failed
commit returns a 2xx and the write is lost (spec §15.1). This walks the
AST of every module under `src/planora_api` directly, rather than trusting
a code review or a `grep`, so a bare/independently-scoped
`Depends(get_db)` reintroduced later fails this test immediately.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

# tests/unit/test_db_dependency_scope.py -> tests/unit -> tests -> apps/api
_API_ROOT = Path(__file__).resolve().parents[2]
_SRC_DIR = _API_ROOT / "src" / "planora_api"
_DEPS_FILE = _SRC_DIR / "api" / "deps.py"


@dataclass(frozen=True)
class _GetDbCallSite:
    path: Path
    lineno: int
    is_alias_definition: bool
    scope_literal: object | None


def _is_get_db_reference(node: ast.expr) -> bool:
    """True for the `get_db` in `Depends(get_db, ...)`, whether imported
    as a bare name or accessed off a module/object (`deps.get_db`)."""
    if isinstance(node, ast.Name):
        return node.id == "get_db"
    if isinstance(node, ast.Attribute):
        return node.attr == "get_db"
    return False


def _scope_literal(call: ast.Call) -> object | None:
    for kw in call.keywords:
        if kw.arg == "scope" and isinstance(kw.value, ast.Constant):
            return kw.value.value
    return None


def _build_parent_map(tree: ast.AST) -> dict[ast.AST, ast.AST]:
    parents: dict[ast.AST, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node
    return parents


def _enclosing_assign_target_name(
    node: ast.AST, parents: dict[ast.AST, ast.AST]
) -> str | None:
    """Walks up from `node` to the nearest enclosing `Assign` with a
    single simple target, and returns that target's name — e.g. `"x"` for
    `x = Annotated[Session, Depends(get_db, scope="function")]`, which is
    exactly the shape of the `DbSession` alias definition."""
    current = node
    while current in parents:
        current = parents[current]
        if isinstance(current, ast.Assign) and len(current.targets) == 1:
            target = current.targets[0]
            if isinstance(target, ast.Name):
                return target.id
    return None


def find_get_db_call_sites(path: Path, source: str) -> list[_GetDbCallSite]:
    """Every `Depends(get_db, ...)` (or `Depends(get_db)`) call in `source`,
    flagging whether each one is the `DbSession` alias definition in
    `api/deps.py`."""
    tree = ast.parse(source, filename=str(path))
    parents = _build_parent_map(tree)
    sites: list[_GetDbCallSite] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        is_depends_call = (isinstance(func, ast.Name) and func.id == "Depends") or (
            isinstance(func, ast.Attribute) and func.attr == "Depends"
        )
        if not is_depends_call:
            continue
        if not node.args or not _is_get_db_reference(node.args[0]):
            continue
        target_name = _enclosing_assign_target_name(node, parents)
        is_alias = path == _DEPS_FILE and target_name == "DbSession"
        sites.append(
            _GetDbCallSite(
                path=path,
                lineno=node.lineno,
                is_alias_definition=is_alias,
                scope_literal=_scope_literal(node),
            )
        )
    return sites


def _all_source_files() -> list[Path]:
    paths = sorted(_SRC_DIR.rglob("*.py"))
    assert paths, f"expected python modules under {_SRC_DIR}"
    return paths


def test_get_db_is_reached_only_through_the_db_session_alias() -> None:
    violations: list[str] = []
    alias_definitions: list[_GetDbCallSite] = []

    for path in _all_source_files():
        sites = find_get_db_call_sites(path, path.read_text())
        for site in sites:
            if site.is_alias_definition:
                alias_definitions.append(site)
            else:
                violations.append(f"{site.path.relative_to(_API_ROOT)}:{site.lineno}")

    assert not violations, (
        "Depends(get_db, ...) outside the DbSession alias definition in "
        f"api/deps.py: {violations} — use `DbSession` from "
        "planora_api.api.deps instead"
    )

    # Non-vacuous: prove the scanner actually looked at call sites, not
    # that it silently matched nothing. It must find exactly the one
    # legitimate definition, with the exact scope the contract requires.
    assert len(alias_definitions) == 1, (
        "expected exactly one DbSession alias definition in "
        f"api/deps.py, found {len(alias_definitions)}"
    )
    assert alias_definitions[0].scope_literal == "function", (
        'the DbSession alias itself must pass scope="function" to get_db'
    )


def test_static_scan_fails_on_an_injected_unscoped_use() -> None:
    injected_source = (
        "from typing import Annotated\n"
        "from fastapi import Depends\n"
        "from sqlalchemy.orm import Session\n"
        "from planora_api.api.deps import get_db\n"
        "\n"
        "def handler(db: Annotated[Session, Depends(get_db)]) -> None:\n"
        "    ...\n"
    )
    # A file path under src/ but not api/deps.py itself, matching how a
    # real regression would show up in a new endpoint module.
    injected_path = _SRC_DIR / "api" / "v1" / "__injected_for_test__.py"

    sites = find_get_db_call_sites(injected_path, injected_source)
    violations = [site for site in sites if not site.is_alias_definition]

    assert violations, (
        "expected the scanner to flag the injected unscoped "
        "Depends(get_db) as a violation, but it found none"
    )
    assert violations[0].scope_literal is None


def test_static_scan_fails_on_an_injected_use_scoped_to_request() -> None:
    injected_source = (
        "from typing import Annotated\n"
        "from fastapi import Depends\n"
        "from sqlalchemy.orm import Session\n"
        "from planora_api.api.deps import get_db\n"
        "\n"
        "def handler(\n"
        '    db: Annotated[Session, Depends(get_db, scope="request")],\n'
        ") -> None:\n"
        "    ...\n"
    )
    injected_path = _SRC_DIR / "api" / "v1" / "__injected_for_test__.py"

    sites = find_get_db_call_sites(injected_path, injected_source)
    violations = [site for site in sites if not site.is_alias_definition]

    assert violations, (
        "expected the scanner to flag the injected request-scoped "
        "Depends(get_db) as a violation even though it passes an "
        "explicit scope"
    )
    assert violations[0].scope_literal == "request"
