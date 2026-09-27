from __future__ import annotations

import json
import logging

from planora_api.logging import JsonFormatter, redact


def test_redact_replaces_sensitive_nested_values_and_bearer_tokens() -> None:
    value = redact(
        {"messages": [{"content": "prompt-sentinel"}], "safe": "Bearer token-sentinel"},
        secrets=("configured-secret",),
    )

    assert value["messages"] == "[REDACTED]"
    assert value["safe"] == "Bearer [REDACTED]"


def test_formatter_redacts_message_arguments_and_keeps_a_json_log_line() -> None:
    record = logging.makeLogRecord(
        {"msg": "login %s", "args": ({"password": "password-sentinel"},), "token": "token-sentinel", "levelno": logging.INFO, "levelname": "INFO"}
    )
    rendered = JsonFormatter(("configured-secret",)).format(record)

    assert "password-sentinel" not in rendered
    assert "token-sentinel" not in rendered
    assert "[REDACTED]" in rendered
    assert json.loads(rendered)["level"] == "INFO"
