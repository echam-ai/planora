"""Tests for issue #34's deterministic OpenAPI export
(`planora_api.openapi`, spec §13.2: "FastAPI's generated `openapi.json` is
the single source of truth").
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from planora_api.openapi import OUTPUT_PATH, build_schema, export, render

# The exact placeholder values `planora_api.openapi` builds the app from —
# none of these may ever appear in the rendered document.
_PLACEHOLDER_SECRETS = (
    "openapi-export-placeholder-secret",
    "openapi-export-placeholder-key",
    "sqlite:///:memory:",
    "https://openapi-export.invalid",
)


def test_build_schema_needs_no_environment_variable(
    clean_env: pytest.MonkeyPatch,
) -> None:
    """Works from a clean checkout with SESSION_SECRET, LLM_API_KEY and
    APP_ORIGIN unset — `clean_env` unsets all seven configuration
    variables, so a `ConfigurationError` here would mean the export reads
    the real environment instead of its own fixed placeholder config."""
    schema = build_schema()
    assert schema["paths"]


def test_two_consecutive_exports_are_byte_identical(
    clean_env: pytest.MonkeyPatch,
) -> None:
    first = render(build_schema())
    second = render(build_schema())
    assert first == second


def test_render_uses_the_pinned_json_formatting(clean_env: pytest.MonkeyPatch) -> None:
    text = render(build_schema())
    assert text.endswith("\n")
    assert not text.endswith("\n\n")
    # indent=2: every nested line after the opening brace is indented.
    lines = text.splitlines()
    assert lines[0] == "{"
    assert lines[1].startswith("  ")
    # Round-trips through the standard library with no surprises.
    json.loads(text)


def test_export_contains_no_placeholder_configuration_value(
    clean_env: pytest.MonkeyPatch,
) -> None:
    text = render(build_schema())
    for secret in _PLACEHOLDER_SECRETS:
        assert secret not in text, f"placeholder value {secret!r} leaked into openapi.json"


def test_export_writes_the_rendered_text_to_the_given_path(
    clean_env: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    destination = tmp_path / "openapi.json"
    written = export(path=destination)
    assert destination.read_text(encoding="utf-8") == written
    assert written == render(build_schema())


def test_output_path_points_at_the_committed_apps_api_openapi_json() -> None:
    assert OUTPUT_PATH.name == "openapi.json"
    # apps/api/src/planora_api/openapi.py -> apps/api/openapi.json
    assert OUTPUT_PATH.parent.name == "api"


def test_committed_openapi_json_matches_a_fresh_export(
    clean_env: pytest.MonkeyPatch,
) -> None:
    """The drift check `uv run pytest` alone catches locally, before CI:
    the committed `apps/api/openapi.json` must equal what
    `build_schema()`/`render()` produce right now. A stale commit fails
    this test, naming the file."""
    assert OUTPUT_PATH.exists(), (
        "apps/api/openapi.json is missing — run "
        "`uv run python -m planora_api.openapi` and commit the result"
    )
    committed = OUTPUT_PATH.read_text(encoding="utf-8")
    fresh = render(build_schema())
    assert committed == fresh, (
        "apps/api/openapi.json is stale — run "
        "`uv run python -m planora_api.openapi` and commit the result"
    )
