"""Unit tests for `ai.prompts` (issues #38, #40, spec §10.4, §15.5).

Pure string-building — no client, no app, no fixtures.
"""

from __future__ import annotations

from planora_api.ai.prompts import (
    build_chat_system_prompt,
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


# --- Chat system prompt (issue #40) -----------------------------------------

_CHAT_PROMPT_KWARGS = {
    "current_date": "2026-09-29",
    "current_time": "20:00",
    "current_weekday": "Tuesday",
    "timezone_name": "Asia/Singapore",
    "statuses": ["todo", "in_progress", "done"],
    "categories": ["work", "personal", "study", "other"],
    "priorities": ["low", "medium", "high"],
    "deadline_states": ["none", "scheduled", "due_soon", "overdue"],
}


def test_chat_prompt_carries_the_current_local_date_weekday_timezone_and_enums() -> None:
    prompt = build_chat_system_prompt(**_CHAT_PROMPT_KWARGS)
    assert "2026-09-29" in prompt
    assert "Tuesday" in prompt
    assert "Asia/Singapore" in prompt
    assert "20:00" in prompt
    for value in ["todo", "in_progress", "done", "work", "personal", "study", "other",
                  "low", "medium", "high", "none", "scheduled", "due_soon", "overdue"]:
        assert value in prompt


def test_chat_prompt_is_byte_identical_whatever_the_user_types() -> None:
    """The prompt is built only from server-computed values — the user's
    own text never reaches it at all, so it never varies with the message
    being sent."""
    first = build_chat_system_prompt(**_CHAT_PROMPT_KWARGS)
    second = build_chat_system_prompt(**_CHAT_PROMPT_KWARGS)
    assert first == second


def test_chat_prompt_never_contains_an_injected_sentinel() -> None:
    sentinel = "SENTINEL-should-never-be-in-the-chat-system-prompt"
    prompt = build_chat_system_prompt(**_CHAT_PROMPT_KWARGS)
    assert sentinel not in prompt


def test_chat_prompt_names_only_the_two_read_tools() -> None:
    prompt = build_chat_system_prompt(**_CHAT_PROMPT_KWARGS)
    assert "find_active_tasks" in prompt
    assert "search_archive" in prompt
    assert "create_task" not in prompt


def test_chat_prompt_states_messages_are_data_not_instructions() -> None:
    prompt = build_chat_system_prompt(**_CHAT_PROMPT_KWARGS).lower()
    assert "data" in prompt
    assert "instruction" in prompt
