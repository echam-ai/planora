"""Enforces issue #32's isolation guarantee: nothing under `planora_api.
main` or `planora_api.api` imports, starts or schedules a job — in-process
scheduling would double-fire the archive job the moment more than one API
worker runs. A static AST scan, matching the style of `tests/unit/
test_db_dependency_scope.py`'s guard for issue #80 (whose *dynamic*
counterpart — actually building the app and inspecting it — lives in
`tests/integration/test_jobs_not_started_by_app.py`, the same split #80
uses between its static and dynamic guards).
"""

from __future__ import annotations

import ast
from pathlib import Path

_API_ROOT = Path(__file__).resolve().parents[2]
_SRC_DIR = _API_ROOT / "src" / "planora_api"
_MAIN_FILE = _SRC_DIR / "main.py"
_API_DIR = _SRC_DIR / "api"


def _imported_module_names(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def _files_under(directory: Path) -> list[Path]:
    paths = sorted(directory.rglob("*.py"))
    assert paths, f"expected python modules under {directory}"
    return paths


def test_main_module_never_imports_the_jobs_package() -> None:
    imported = _imported_module_names(_MAIN_FILE)
    offending = {name for name in imported if name.split(".")[:2] == ["planora_api", "jobs"]}
    assert not offending, f"main.py imports the jobs package: {offending!r}"


def test_no_api_module_imports_the_jobs_package() -> None:
    violations: list[str] = []
    for path in _files_under(_API_DIR):
        imported = _imported_module_names(path)
        offending = {n for n in imported if n.split(".")[:2] == ["planora_api", "jobs"]}
        if offending:
            violations.append(f"{path.relative_to(_API_ROOT)}: {offending!r}")
    assert not violations, f"api/ modules importing planora_api.jobs: {violations}"


def test_static_scan_fails_on_an_injected_jobs_import() -> None:
    """Proves the scanner above isn't vacuously green."""
    injected_source = "from planora_api.jobs import scheduler\n"
    injected_path = _API_DIR / "v1" / "__injected_for_test__.py"
    imported = _imported_module_names_from_source(injected_source, injected_path)
    offending = {n for n in imported if n.split(".")[:2] == ["planora_api", "jobs"]}
    assert offending


def _imported_module_names_from_source(source: str, path: Path) -> set[str]:
    tree = ast.parse(source, filename=str(path))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names
