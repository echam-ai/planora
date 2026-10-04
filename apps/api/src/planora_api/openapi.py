"""Deterministic OpenAPI export (issue #34, spec §13.2: "FastAPI's
generated `openapi.json` is the single source of truth").

`uv run python -m planora_api.openapi` writes the app's OpenAPI document to
the committed `apps/api/openapi.json` — the file the web tier's
`schema.gen.ts` (#35) is generated from. Building the app for this purpose
needs no running server, no database connection and no real secrets:
`_PLACEHOLDER_SETTINGS` below passes every `Settings` field as an explicit
keyword argument, which pydantic-settings treats as the highest-priority
source, so construction never reads `APP_PASSWORD`, `SESSION_SECRET`, `LLM_API_KEY`,
`APP_ORIGIN` or any other environment variable or `.env` file — the export
is identical whether those are set, unset, or set to something else
entirely. None of the placeholder values below ever reaches the exported
document: OpenAPI generation inspects only route and Pydantic model
metadata, never `app.state`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from planora_api.config import Settings
from planora_api.main import create_app

# Fixed, non-secret placeholder configuration used only to build the app
# for export. Values are deliberately obvious placeholders (never a real
# secret, database URL or origin) — `test_openapi_export.py` asserts none
# of them appear in the rendered document.
_PLACEHOLDER_SETTINGS = Settings(
    database_url="sqlite:///:memory:",
    app_password="openapi-export-placeholder-password",
    session_secret="openapi-export-placeholder-session-secret",
    llm_base_url="https://llm.invalid/v1",
    llm_api_key="openapi-export-placeholder-key",
    llm_model="openapi-export-placeholder-model",
    app_origin="https://openapi-export.invalid",
    default_timezone="UTC",
    log_level="ERROR",
)

# apps/api/src/planora_api/openapi.py -> planora_api -> src -> apps/api
OUTPUT_PATH = Path(__file__).resolve().parents[2] / "openapi.json"


def build_schema() -> dict[str, Any]:
    """The exported app's OpenAPI document.

    Builds a fresh `FastAPI` app from fixed placeholder configuration —
    never the real environment — so the result depends on no configuration
    value and needs no running server or database connection.
    """
    app = create_app(settings=_PLACEHOLDER_SETTINGS)
    return app.openapi()


def render(schema: dict[str, Any]) -> str:
    """Deterministic text for `schema`: fixed indent, no ASCII-escaping,
    keys sorted (so the output depends on neither dict insertion order nor
    the Python minor version), and a trailing newline."""
    return json.dumps(schema, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def export(path: Path = OUTPUT_PATH) -> str:
    """Render the current schema and write it to `path`, returning the
    text written."""
    text = render(build_schema())
    path.write_text(text, encoding="utf-8")
    return text


if __name__ == "__main__":  # pragma: no cover - process bootstrap, not importable
    export()
