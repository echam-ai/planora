"""Unit tests for `ai.parse_task`'s pure helper functions (issue #38,
spec §6.1, §6.2). The full async `parse_task_text` flow (LLM call,
strict-parse failure -> `LLMUnavailableError`, cancellation) is covered by
the integration suite (`tests/integration/test_ai_parse_task.py`), which
needs a running app and `FakeLLMClient`; these functions need neither.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from planora_api.ai.parse_task import (
    _ParsedTaskOutput,
    _ParsedUrl,
    derive_content,
    derive_title,
    filter_urls,
    resolve_deadline,
)
from planora_api.db.models import TaskCategory, TaskPriority

# --- derive_title -----------------------------------------------------


def test_derive_title_uses_the_model_title_when_present() -> None:
    assert derive_title("Prepare the review", "some input text") == "Prepare the review"


def test_derive_title_strips_the_model_title() -> None:
    assert derive_title("  Prepare the review  ", "text") == "Prepare the review"


def test_derive_title_truncates_a_too_long_model_title() -> None:
    long_title = "x" * 200
    result = derive_title(long_title, "text")
    assert result == "x" * 120
    assert len(result) == 120


def test_derive_title_falls_back_to_the_first_line_when_model_title_is_none() -> None:
    assert derive_title(None, "buy milk and eggs\nfrom the corner shop") == "buy milk and eggs"


def test_derive_title_falls_back_to_the_first_line_when_model_title_is_blank() -> None:
    assert derive_title("   ", "buy milk and eggs\nfrom the corner shop") == "buy milk and eggs"


def test_derive_title_truncates_a_long_first_line_fallback() -> None:
    text = "x" * 200
    assert derive_title(None, text) == "x" * 120


# --- derive_content -----------------------------------------------------


def test_derive_content_uses_the_model_content_when_present() -> None:
    assert derive_content("A clean summary.", "raw text") == "A clean summary."


def test_derive_content_falls_back_to_the_input_text() -> None:
    # `text` here is assumed already trimmed by the wire schema
    # (`ParseTaskRequest`) — `derive_content` does not re-trim it.
    assert derive_content(None, "raw text") == "raw text"


def test_derive_content_falls_back_when_model_content_is_blank() -> None:
    assert derive_content("   ", "raw text") == "raw text"


# --- filter_urls: verbatim, scheme, dedup, label length ------------------


def test_filter_urls_keeps_a_url_present_verbatim_in_the_text() -> None:
    text = "See https://dash.example/exp for details."
    urls = [_ParsedUrl(url="https://dash.example/exp", label="dashboard")]
    result = filter_urls(urls, text)
    assert result == [{"url": "https://dash.example/exp", "label": "dashboard"}]


def test_filter_urls_drops_a_url_absent_from_the_text() -> None:
    text = "No links here."
    urls = [_ParsedUrl(url="https://evil.example", label=None)]
    assert filter_urls(urls, text) == []


def test_filter_urls_drops_a_non_http_scheme() -> None:
    text = "javascript:alert(1) appears right here"
    urls = [_ParsedUrl(url="javascript:alert(1)", label=None)]
    assert filter_urls(urls, text) == []


def test_filter_urls_collapses_duplicates() -> None:
    text = "https://dash.example/exp and again https://dash.example/exp"
    urls = [
        _ParsedUrl(url="https://dash.example/exp", label="first"),
        _ParsedUrl(url="https://dash.example/exp", label="second"),
    ]
    result = filter_urls(urls, text)
    assert len(result) == 1


def test_filter_urls_truncates_a_long_label() -> None:
    text = "https://dash.example/exp"
    urls = [_ParsedUrl(url="https://dash.example/exp", label="y" * 300)]
    result = filter_urls(urls, text)
    assert result[0]["label"] == "y" * 200


def test_filter_urls_keeps_a_null_label() -> None:
    text = "https://dash.example/exp"
    urls = [_ParsedUrl(url="https://dash.example/exp", label=None)]
    result = filter_urls(urls, text)
    assert result[0]["label"] is None


# --- resolve_deadline -----------------------------------------------------


def test_resolve_deadline_none_is_none() -> None:
    assert resolve_deadline(None, "UTC") is None


def test_resolve_deadline_with_time_converts_via_the_effective_timezone() -> None:
    result = resolve_deadline("2026-09-29T15:00", "Asia/Singapore")
    assert result == datetime(2026, 9, 29, 7, 0, tzinfo=UTC)


def test_resolve_deadline_date_only_means_23_59_local() -> None:
    result = resolve_deadline("2026-10-02", "Asia/Singapore")
    assert result == datetime(2026, 10, 2, 15, 59, tzinfo=UTC)


# --- _ParsedTaskOutput: strict validation ---------------------------------


def test_parsed_task_output_rejects_an_unknown_field() -> None:
    with pytest.raises(ValidationError):
        _ParsedTaskOutput.model_validate({"title": "t", "unexpected_field": 1})


def test_parsed_task_output_accepts_omitted_optional_fields() -> None:
    parsed = _ParsedTaskOutput.model_validate({})
    assert parsed.title is None
    assert parsed.category is None
    assert parsed.priority is None
    assert parsed.deadline is None
    assert parsed.urls == []


def test_parsed_task_output_rejects_a_category_outside_the_enum() -> None:
    with pytest.raises(ValidationError):
        _ParsedTaskOutput.model_validate({"category": "admin"})


def test_parsed_task_output_accepts_a_real_enum_value() -> None:
    parsed = _ParsedTaskOutput.model_validate({"category": "work", "priority": "high"})
    assert parsed.category == TaskCategory.WORK
    assert parsed.priority == TaskPriority.HIGH


def test_parsed_task_output_rejects_a_non_string_title() -> None:
    with pytest.raises(ValidationError):
        _ParsedTaskOutput.model_validate({"title": 12345})


@pytest.mark.parametrize(
    "deadline",
    [
        "next Friday-ish",
        "2026-13-01",  # month 13
        "2026-02-30",  # Feb 30 does not exist
        "2026-09-29T25:00",  # hour 25
        "09/29/2026",
        "2026-09-29 15:00",  # space instead of T
    ],
)
def test_parsed_task_output_rejects_a_malformed_or_impossible_date(deadline: str) -> None:
    with pytest.raises(ValidationError):
        _ParsedTaskOutput.model_validate({"deadline": deadline})


@pytest.mark.parametrize("deadline", ["2026-09-29", "2026-09-29T15:00"])
def test_parsed_task_output_accepts_valid_dates(deadline: str) -> None:
    parsed = _ParsedTaskOutput.model_validate({"deadline": deadline})
    assert parsed.deadline == deadline
