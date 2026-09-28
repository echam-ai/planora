"""Unit tests for `ai.redact` (issue #37, spec §15.5): every summary is
counts, roles, names and metadata only — never message content, completion
text or tool-call argument text.
"""

from __future__ import annotations

from planora_api.ai.client import LLMCompletion, LLMToolCall, LLMUsage
from planora_api.ai.redact import summarize_completion, summarize_messages


def test_summarize_messages_reports_count_roles_and_total_chars_only() -> None:
    sentinel = "SENTINEL-prompt-content-should-never-appear"
    messages = [
        {"role": "system", "content": "You are Planora."},
        {"role": "user", "content": sentinel},
    ]

    summary = summarize_messages(messages)

    assert summary["message_count"] == 2
    assert summary["roles"] == ["system", "user"]
    assert summary["total_chars"] == len("You are Planora.") + len(sentinel)
    assert sentinel not in str(summary)


def test_summarize_messages_handles_a_message_with_no_content() -> None:
    messages = [{"role": "assistant", "content": None}]
    summary = summarize_messages(messages)
    assert summary["message_count"] == 1
    assert summary["total_chars"] == 0


def test_summarize_completion_reports_tool_names_finish_reason_and_usage() -> None:
    sentinel_args = "SENTINEL-tool-call-arguments"
    sentinel_content = "SENTINEL-completion-content"
    completion = LLMCompletion(
        content=sentinel_content,
        tool_calls=(LLMToolCall(id="call_1", name="move_task", arguments_json=sentinel_args),),
        finish_reason="tool_calls",
        usage=LLMUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
    )

    summary = summarize_completion(completion)

    assert summary["tool_names"] == ["move_task"]
    assert summary["finish_reason"] == "tool_calls"
    assert summary["usage"] == {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    assert summary["has_content"] is True
    assert sentinel_args not in str(summary)
    assert sentinel_content not in str(summary)


def test_summarize_completion_with_no_tool_calls_or_usage() -> None:
    completion = LLMCompletion(content="Hello", tool_calls=(), finish_reason="stop", usage=None)
    summary = summarize_completion(completion)
    assert summary["tool_names"] == []
    assert "usage" not in summary
    assert summary["has_content"] is True
