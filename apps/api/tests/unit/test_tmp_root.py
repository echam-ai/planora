"""Binding rule 10: pytest temp directories live under the repo's `.tmp/`."""

from __future__ import annotations

from pathlib import Path


def _repo_root() -> Path:
    # tests/unit/test_tmp_root.py -> apps/api/tests/unit -> repo root
    return Path(__file__).resolve().parents[4]


def test_tmp_path_is_inside_repo_tmp(tmp_path: Path) -> None:
    repo_tmp = (_repo_root() / ".tmp").resolve()
    assert tmp_path.resolve().is_relative_to(repo_tmp)


def test_tmp_path_factory_is_inside_repo_tmp(tmp_path_factory) -> None:
    repo_tmp = (_repo_root() / ".tmp").resolve()
    assert tmp_path_factory.getbasetemp().resolve().is_relative_to(repo_tmp)
