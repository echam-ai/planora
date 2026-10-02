"""Validators shared across wire schemas and tool-argument models."""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator

_TEXT_MIN_LENGTH = 1
_TEXT_MAX_LENGTH = 4000


def non_blank(value: str, field_name: str | None = None) -> str:
    """`value` trimmed; `ValueError` if nothing is left. The message is
    `"{field_name} must not be blank"`, or just `"must not be blank"` when
    no field name is given."""
    stripped = value.strip()
    if not stripped:
        raise ValueError(
            f"{field_name} must not be blank" if field_name else "must not be blank"
        )
    return stripped


def _trim_to_1_to_4000_chars(value: str) -> str:
    stripped = value.strip()
    if not (_TEXT_MIN_LENGTH <= len(stripped) <= _TEXT_MAX_LENGTH):
        raise ValueError(
            f"text must be {_TEXT_MIN_LENGTH} to {_TEXT_MAX_LENGTH} "
            "characters after trimming"
        )
    return stripped


# `text` fields of `POST /ai/parse-task` and `POST /chat/messages`: 1 to
# 4000 characters *after* trimming, and the trimmed value is what is kept.
TrimmedText = Annotated[str, AfterValidator(_trim_to_1_to_4000_chars)]
