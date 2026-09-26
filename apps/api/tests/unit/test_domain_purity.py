"""Enforces binding rule 5: `domain/` modules do no I/O.

Walks the AST of every module under `domain/` and inspects its imports
directly, rather than trusting a code review — a banned import reintroduced
later (a database call, a network client, a clock read) fails this test
immediately instead of surfacing as a flaky or untestable side effect.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

# tests/unit/test_domain_purity.py -> tests/unit -> tests -> apps/api
_API_ROOT = Path(__file__).resolve().parents[2]
_DOMAIN_DIR = _API_ROOT / "src" / "planora_api" / "domain"

# Explicitly named by issue #23, plus the network/file/time-reading
# categories the spec's "no I/O" rule is guarding against. `datetime` itself
# is not banned — the modules need it for type hints and arithmetic; what
# they must never do is *read the clock* (call `.now()`/`.utcnow()` without
# it being handed to them), which the "never read the clock" test enforces
# separately by asserting determinism.
_BANNED_MODULES: frozenset[str] = frozenset(
    {
        "sqlalchemy",
        "fastapi",
        "planora_api.db",
        "planora_api.config",
        "time",
        "os",
        "socket",
        "subprocess",
        "pathlib",
        "io",
        "urllib",
        "http",
        "requests",
        "httpx",
    }
)


def _is_banned(module_name: str) -> bool:
    return any(
        module_name == banned or module_name.startswith(f"{banned}.")
        for banned in _BANNED_MODULES
    )


# Every file under `domain/` — including its own `__init__.py` — shares
# this `__package__` at import time: a package's `__init__.py` has
# `__package__` equal to the package itself, and a regular module's
# `__package__` is the package containing it, so both resolve relative
# imports the same way.
_PACKAGE = "planora_api.domain"


def _resolve_relative_base(level: int) -> str:
    """The absolute package a relative import's dots resolve against.

    `from . import x` (level 1) resolves within `_PACKAGE` itself;
    `from .. import x` (level 2) resolves within its parent, and so on —
    exactly what the interpreter does when it walks up `__package__` by
    `level - 1` steps before applying the import.
    """
    parts = _PACKAGE.split(".")
    keep = len(parts) - (level - 1)
    return ".".join(parts[:keep]) if keep > 0 else ""


def _imported_module_names(source: str) -> set[str]:
    tree = ast.parse(source)
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0:
                # Absolute import: `node.module` is the full dotted name.
                if node.module is not None:
                    names.add(node.module)
                continue
            # Relative import — `from ..db.models import Task`,
            # `from .. import db`, `from ..config import Settings` all
            # resolve outside `domain/` and must be checked just like an
            # absolute import would be, not skipped.
            base = _resolve_relative_base(node.level)
            if node.module is not None:
                # `from ..config import Settings` -> "planora_api.config"
                names.add(f"{base}.{node.module}" if base else node.module)
            else:
                # `from .. import db` -> "planora_api.db"
                names.update(
                    f"{base}.{alias.name}" if base else alias.name
                    for alias in node.names
                )
    return names


def _domain_module_paths() -> list[Path]:
    assert _DOMAIN_DIR.is_dir(), f"expected a domain/ package at {_DOMAIN_DIR}"
    paths = sorted(_DOMAIN_DIR.glob("*.py"))
    assert paths, "expected at least one module under domain/"
    return paths


@pytest.mark.parametrize(
    "module_path", _domain_module_paths(), ids=lambda p: p.name
)
def test_domain_module_imports_no_banned_dependency(module_path: Path) -> None:
    imported = _imported_module_names(module_path.read_text())
    banned_here = {name for name in imported if _is_banned(name)}
    assert not banned_here, (
        f"{module_path.name} imports banned module(s) {sorted(banned_here)} "
        "— domain/ modules must do no I/O (binding rule 5)"
    )


# --- Relative imports must resolve, not be skipped --------------------------
#
# A module under `domain/` reaching `planora_api.db` or `planora_api.config`
# through a relative import (`from ..db.models import Task`) is exactly as
# much a binding-rule-5 violation as an absolute one; it must be resolved
# against `_PACKAGE` and checked, never waved through because it has dots.


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("from ..db.models import Task\n", "planora_api.db.models"),
        ("from .. import db\n", "planora_api.db"),
        ("from ..config import Settings\n", "planora_api.config"),
    ],
)
def test_relative_imports_resolve_against_the_domain_package(
    source: str, expected: str
) -> None:
    resolved = _imported_module_names(source)
    assert expected in resolved
    assert _is_banned(expected)


def test_relative_imports_are_flagged_as_banned_dependencies() -> None:
    source = (
        "from ..db.models import Task\n"
        "from .. import db\n"
        "from ..config import Settings\n"
    )
    imported = _imported_module_names(source)
    banned_here = {name for name in imported if _is_banned(name)}
    assert banned_here == {
        "planora_api.db.models",
        "planora_api.db",
        "planora_api.config",
    }
