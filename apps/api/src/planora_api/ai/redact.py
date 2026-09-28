"""Log-safe summaries of LLM requests and completions (issue #37, spec
§15.5: logs redact "API keys, full chat prompts, and sensitive task
content by default").

Every function here returns counts, roles, names and metadata only —
never message content, a completion's text, or a tool call's raw argument
string. `ai.client.HttpLLMClient` logs exclusively through these
summaries; nothing upstream of this module needs to hold that discipline
itself.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    # Only for type checking — importing this at runtime would make
    # `ai.client` (which imports these summarizers) and `ai.redact` a
    # circular pair.
    from planora_api.ai.client import LLMCompletion


def summarize_messages(messages: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """`message_count`, `roles` (in order) and `total_chars` (the summed
    length of every message's `content`, treating a missing/`None` content
    as zero) — never the content itself."""
    roles: list[str] = []
    total_chars = 0
    for message in messages:
        roles.append(str(message.get("role")))
        content = message.get("content")
        if content is not None:
            total_chars += len(str(content))
    return {"message_count": len(messages), "roles": roles, "total_chars": total_chars}


def summarize_completion(completion: LLMCompletion) -> dict[str, Any]:
    """`has_content`, `tool_names` (never their arguments), `finish_reason`
    and token `usage` — never the completion's own content text."""
    summary: dict[str, Any] = {
        "has_content": completion.content is not None,
        "tool_names": [call.name for call in completion.tool_calls],
        "finish_reason": completion.finish_reason,
    }
    if completion.usage is not None:
        summary["usage"] = {
            "prompt_tokens": completion.usage.prompt_tokens,
            "completion_tokens": completion.usage.completion_tokens,
            "total_tokens": completion.usage.total_tokens,
        }
    return summary
