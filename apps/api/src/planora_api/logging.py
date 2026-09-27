"""JSON logging with request correlation and conservative secret redaction."""

from __future__ import annotations

import json
import logging
import re
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
_REDACTED = "[REDACTED]"
_KEY_PARTS = ("password", "secret", "token", "api_key", "apikey", "authorization", "cookie", "session")
_EXACT_KEYS = frozenset({"prompt", "messages", "content", "text", "title", "notes", "q", "query", "search", "body"})
_BEARER = re.compile(r"(?i)Bearer\s+[^\s,;]+")
_SESSION_COOKIE = re.compile(r"(?i)(planora_session=)[^;\s,]+")
_URL_PASSWORD = re.compile(r"(://[^:/@]+:)[^@/]+(@)")
_INPUT_VALUE = re.compile(r"(input_value=)(?:[^,\n]+)")
_STANDARD = frozenset(logging.LogRecord(None, 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}


def request_id() -> str | None:
    return _request_id.get()


def set_request_id(value: str) -> object:
    return _request_id.set(value)


def reset_request_id(token: object) -> None:
    _request_id.reset(token)  # type: ignore[arg-type]


def _sensitive_key(key: object) -> bool:
    name = str(key).lower()
    return name in _EXACT_KEYS or any(part in name for part in _KEY_PARTS)


def redact(value: Any, *, secrets: tuple[str, ...] = ()) -> Any:
    """Redact sensitive values recursively, then redact secrets embedded in text."""
    if isinstance(value, dict):
        return {key: _REDACTED if _sensitive_key(key) else redact(item, secrets=secrets) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(item, secrets=secrets) for item in value]
    if not isinstance(value, str):
        return value
    result = value
    for secret in secrets:
        if secret:
            result = result.replace(secret, _REDACTED)
    result = _URL_PASSWORD.sub(r"\1[REDACTED]\2", result)
    result = _BEARER.sub("Bearer [REDACTED]", result)
    result = _SESSION_COOKIE.sub(r"\1[REDACTED]", result)
    return _INPUT_VALUE.sub(r"\1[REDACTED]", result)


class JsonFormatter(logging.Formatter):
    def __init__(self, secrets: tuple[str, ...]) -> None:
        super().__init__()
        self._secrets = secrets

    def format(self, record: logging.LogRecord) -> str:
        message_args = redact(record.args, secrets=self._secrets)
        try:
            message = str(record.msg) % (
                tuple(message_args) if isinstance(message_args, list) else message_args
            ) if message_args else str(record.msg)
        except (TypeError, ValueError):
            message = record.getMessage()
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "level": record.levelname.upper(),
            "logger": record.name,
            "message": message,
        }
        current_request_id = request_id()
        if current_request_id:
            payload["request_id"] = current_request_id
        payload.update({key: value for key, value in record.__dict__.items() if key not in _STANDARD and not key.startswith("_")})
        if record.exc_info:
            payload["traceback"] = self.formatException(record.exc_info)
        return json.dumps(redact(payload, secrets=self._secrets), default=str, separators=(",", ":"))


def configure_logging(*, level: str, secrets: tuple[str, ...]) -> None:
    """Configure root logging once per app factory invocation.

    Re-binds the handler's stream to the *current* `sys.stdout` on every
    call, not just its first. A plain `logging.StreamHandler` captures
    whatever `sys.stdout` object is live at construction time and keeps
    writing to it even if `sys.stdout` is later replaced — harmless in
    production, where the stream never changes, but fatal for a test
    session that calls `create_app()` (and so this function) more than
    once: pytest's `capsys` swaps `sys.stdout` per test, so a handler built
    during an earlier test would otherwise go on writing into that test's
    already-detached buffer, and a later test's `capsys.readouterr()` would
    see nothing at all — silently, not as a failure.
    """
    root = logging.getLogger()
    root.setLevel(getattr(logging, level))
    for handler in root.handlers:
        if getattr(handler, "_planora_json", False):
            handler.stream = sys.stdout
            handler.setLevel(getattr(logging, level))
            handler.setFormatter(JsonFormatter(secrets))
            break
    else:
        handler = logging.StreamHandler(sys.stdout)
        handler._planora_json = True  # type: ignore[attr-defined]
        handler.setLevel(getattr(logging, level))
        handler.setFormatter(JsonFormatter(secrets))
        root.addHandler(handler)
    for name in ("uvicorn.error", "fastapi", "sqlalchemy"):
        named_logger = logging.getLogger(name)
        named_logger.handlers.clear()
        named_logger.propagate = True
    logging.getLogger("uvicorn.access").disabled = True
