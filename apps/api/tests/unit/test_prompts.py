"""Unit tests for `ai.prompts` (issue #38, spec §10.4, §15.5).

Pure string-building — no client, no app, no fixtures.
"""

from __future__ import annotations

from planora_api.ai.prompts import (
    build_parse_task_system_prompt,
    build_parse_task_user_message,
)


def test_system_prompt_carries_the_current_local_date_weekday_and_timezone() -> None:
    prompt = build_parse_task_system_prompt(
        current_date="2026-09-28",
        current_time="10:00",
        current_weekday="Monday",
        timezone_name="Asia/Singapore",
        categories=["work", "personal", "study", "other"],
        priorities=["low", "medium", "high"],
    )
    assert "2026-09-28" in prompt
    assert "Monday" in prompt
    assert "Asia/Singapore" in prompt
    assert "work" in prompt and "personal" in prompt and "study" in prompt and "other" in prompt
    assert "low" in prompt and "medium" in prompt and "high" in prompt


def test_system_prompt_never_contains_user_text() -> None:
    sentinel = "SENTINEL-should-never-be-in-the-system-prompt"
    prompt = build_parse_task_system_prompt(
        current_date="2026-09-28",
        current_time="10:00",
        current_weekday="Monday",
        timezone_name="UTC",
        categories=["other"],
        priorities=["medium"],
    )
    assert sentinel not in prompt


def test_system_prompt_states_the_text_is_data_not_instructions() -> None:
    prompt = build_parse_task_system_prompt(
        current_date="2026-09-28",
        current_time="10:00",
        current_weekday="Monday",
        timezone_name="UTC",
        categories=["other"],
        priorities=["medium"],
    )
    lowered = prompt.lower()
    assert "data" in lowered
    assert "instruction" in lowered


def test_user_message_wraps_the_text_as_delimited_data() -> None:
    text = "Prepare the search-quality review by Friday 4 PM."
    message = build_parse_task_user_message(text)
    assert text in message
    # Delimited, not bare — distinguishable from an instruction to the model.
    assert message != text
