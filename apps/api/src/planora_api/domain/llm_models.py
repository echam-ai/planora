"""Which LLM model names a deployment offers (issue #86, spec §11).

Pure: takes the deployment default and the raw `LLM_ALLOWED_MODELS` string
and returns the ordered list. No I/O, no configuration access (binding
rule 5).
"""

from __future__ import annotations


def available_models(default_model: str, allowed_models: str | None) -> list[str]:
    """`default_model` first, then each comma-separated `allowed_models`
    entry not already listed, in the given order.

    Entries are trimmed and empty entries ignored, so an unset or blank
    value yields exactly `[default_model]`.
    """
    models = [default_model]
    for entry in (allowed_models or "").split(","):
        name = entry.strip()
        if name and name not in models:
            models.append(name)
    return models
