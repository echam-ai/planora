"""LLM HTTP client (issue #37, spec §10.4, §19.2, ADR 0001/0002).

One async `complete()` call to the configured OpenAI-compatible
`/chat/completions` endpoint. No SDK (`httpx` only — ADR 0001 names
`openai` only under the rejected all-TypeScript option, and one POST
doesn't justify a new dependency tree), no streaming in v1 (spec §13.1
allows it "if needed" later, behind this same protocol), no automatic
retries (spec §10.4: "AI errors must result in a recoverable message" —
a failed call is reported once and the user retries from the UI).

Every failure raises exactly one exception type, `LLMUnavailableError`,
always `from None` so no chained `httpx` exception, URL, header or body
travels with it. `register_llm_error_handler` maps it to a flat `503
AI_UNAVAILABLE`. Logging goes only through `ai.redact`'s summaries — this
module never logs a prompt, a completion's content, or a tool call's raw
argument text, and it never logs the provider's response body.

Validating structured output (a `response_format` JSON schema, tool-call
arguments) is left to consumers (#38, #40, #41) — `tool_calls` here carry
each call's raw, unparsed argument string.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from planora_api.ai.redact import summarize_completion, summarize_messages

logger = logging.getLogger("planora_api.ai.client")

# 5 s to connect, 60 s for read/write/pool — fixed module constants
# (pinned at #37's grooming: no configuration variable for this).
CONNECT_TIMEOUT = 5.0
READ_TIMEOUT = 60.0
TIMEOUT = httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT)

_CHAT_COMPLETIONS_PATH = "/chat/completions"

# The one user-facing sentence for every failure — never the provider's
# real status, body, URL, or a chained exception.
SAFE_MESSAGE = "The assistant is unavailable right now. Try again."

LLMFailureReason = Literal[
    "timeout", "connect_error", "http_status", "invalid_response", "cancelled"
]


class LLMUnavailableError(Exception):
    """Raised for every LLM call failure — the only exception type this
    module (and `ai.deps.run_cancellable`) ever raises. `reason` is one of
    `LLMFailureReason`; `status` is the provider's HTTP status when
    `reason="http_status"`, else `None`.

    `str()` is always the fixed `SAFE_MESSAGE`, regardless of `reason` —
    nothing provider-specific ever travels with this error. Every raise
    site uses `raise LLMUnavailableError(...) from None` so no chained
    `httpx` exception (with its URL, headers or body) survives in
    `__cause__`/`__context__`.
    """

    def __init__(self, reason: LLMFailureReason, *, status: int | None = None) -> None:
        super().__init__(SAFE_MESSAGE)
        self.reason = reason
        self.status = status


@dataclass(frozen=True)
class LLMToolCall:
    """One tool call from the assistant. `arguments_json` is the raw,
    unparsed JSON argument string — validating it against a server-side
    schema is the consumer's job (#38, #40, #41), not this client's."""

    id: str
    name: str
    arguments_json: str


@dataclass(frozen=True)
class LLMUsage:
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


@dataclass(frozen=True)
class LLMCompletion:
    """One `complete()` result: the assistant's `content` (or `None` for a
    tool-call-only turn), any `tool_calls`, the provider's `finish_reason`,
    and token `usage` if the provider reported it."""

    content: str | None
    tool_calls: tuple[LLMToolCall, ...]
    finish_reason: str | None
    usage: LLMUsage | None


class LLMClient(Protocol):
    """Structural protocol every LLM implementation (the real HTTP client
    or `ai.fake.FakeLLMClient`) satisfies: one async `complete()`. Neither
    implementation needs to inherit from this — `Protocol` matching is
    structural.

    `model` is the caller's already-resolved *effective* model name
    (`db.settings_repository.get_effective_settings(db, settings)
    .model_name` — issue #31) — resolved fresh by the caller on every
    call, so a Settings change applies to the next request with no
    restart; this client never reads or caches it itself.
    """

    async def complete(
        self,
        messages: Sequence[Mapping[str, Any]],
        *,
        model: str,
        response_format: Mapping[str, Any] | None = None,
        tools: Sequence[Mapping[str, Any]] | None = None,
        tool_choice: Any | None = None,
    ) -> LLMCompletion: ...


# --- Strict parsing of the provider's response ------------------------
#
# A body that isn't JSON, lacks `choices[0].message`, or carries the wrong
# type anywhere raises `LLMUnavailableError(reason="invalid_response")` —
# never a raw `KeyError`/`ValidationError` escaping `complete()`.


class _ProviderFunctionCall(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    arguments: str


class _ProviderToolCall(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    function: _ProviderFunctionCall


class _ProviderMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    content: str | None = None
    tool_calls: list[_ProviderToolCall] | None = None


class _ProviderChoice(BaseModel):
    model_config = ConfigDict(extra="ignore")
    message: _ProviderMessage
    finish_reason: str | None = None


class _ProviderUsage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class _ProviderResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    choices: list[_ProviderChoice]
    usage: _ProviderUsage | None = None

    @field_validator("choices")
    @classmethod
    def _choices_must_not_be_empty(
        cls, value: list[_ProviderChoice]
    ) -> list[_ProviderChoice]:
        if not value:
            raise ValueError("choices must not be empty")
        return value


def _completion_from_provider_payload(payload: Any) -> LLMCompletion:
    """Raises `pydantic.ValidationError` for anything wrong-shaped —
    caught by `HttpLLMClient.complete`, never surfaced directly."""
    parsed = _ProviderResponse.model_validate(payload)
    choice = parsed.choices[0]
    tool_calls = tuple(
        LLMToolCall(id=call.id, name=call.function.name, arguments_json=call.function.arguments)
        for call in (choice.message.tool_calls or [])
    )
    usage = (
        LLMUsage(
            prompt_tokens=parsed.usage.prompt_tokens,
            completion_tokens=parsed.usage.completion_tokens,
            total_tokens=parsed.usage.total_tokens,
        )
        if parsed.usage is not None
        else None
    )
    return LLMCompletion(
        content=choice.message.content,
        tool_calls=tool_calls,
        finish_reason=choice.finish_reason,
        usage=usage,
    )


class HttpLLMClient:
    """`LLMClient` over one shared `httpx.AsyncClient` — lifespan-managed,
    see `main.create_app` and `ai.deps.get_llm_client`. Never constructed
    per-request."""

    def __init__(self, http_client: httpx.AsyncClient, *, base_url: str, api_key: str) -> None:
        self._http_client = http_client
        # Tolerate a trailing slash on the configured base URL with no
        # double `//` — built explicitly here rather than relying on
        # httpx's own `base_url` + relative-path joining, whose RFC 3986
        # `urljoin` semantics silently drop the base path's last segment
        # unless both sides carry a trailing slash.
        self._url = f"{base_url.rstrip('/')}{_CHAT_COMPLETIONS_PATH}"
        self._headers = {"Authorization": f"Bearer {api_key}"}

    @property
    def http_client(self) -> httpx.AsyncClient:
        """The underlying `httpx.AsyncClient` — exposed only so a test can
        assert it was closed after the app's lifespan shuts down."""
        return self._http_client

    async def complete(
        self,
        messages: Sequence[Mapping[str, Any]],
        *,
        model: str,
        response_format: Mapping[str, Any] | None = None,
        tools: Sequence[Mapping[str, Any]] | None = None,
        tool_choice: Any | None = None,
    ) -> LLMCompletion:
        message_list = list(messages)
        body: dict[str, Any] = {"model": model, "messages": message_list}
        if response_format is not None:
            body["response_format"] = response_format
        if tools is not None:
            body["tools"] = tools
        if tool_choice is not None:
            body["tool_choice"] = tool_choice

        started = time.perf_counter()
        try:
            response = await self._http_client.post(
                self._url, json=body, headers=self._headers, timeout=TIMEOUT
            )
        except httpx.TimeoutException:
            self._log_failure("timeout", status=None, started=started)
            raise LLMUnavailableError("timeout") from None
        except httpx.RequestError:
            self._log_failure("connect_error", status=None, started=started)
            raise LLMUnavailableError("connect_error") from None

        if response.status_code >= 400:
            self._log_failure("http_status", status=response.status_code, started=started)
            raise LLMUnavailableError("http_status", status=response.status_code) from None

        try:
            payload = response.json()
            completion = _completion_from_provider_payload(payload)
        except (ValueError, ValidationError):
            self._log_failure("invalid_response", status=response.status_code, started=started)
            raise LLMUnavailableError("invalid_response") from None

        self._log_success(
            model=model,
            status=response.status_code,
            started=started,
            messages=message_list,
            completion=completion,
        )
        return completion

    def _log_failure(
        self, reason: LLMFailureReason, *, status: int | None, started: float
    ) -> None:
        logger.error(
            "llm_request_failed",
            extra={
                "reason": reason,
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 3),
            },
        )

    def _log_success(
        self,
        *,
        model: str,
        status: int,
        started: float,
        messages: Sequence[Mapping[str, Any]],
        completion: LLMCompletion,
    ) -> None:
        summary = {**summarize_messages(messages), **summarize_completion(completion)}
        logger.info(
            "llm_request_completed",
            extra={
                "model": model,
                "status": status,
                "duration_ms": round((time.perf_counter() - started) * 1000, 3),
                **summary,
            },
        )


def register_llm_error_handler(app: FastAPI) -> None:
    """Turns every `LLMUnavailableError` into a flat `503 AI_UNAVAILABLE`.
    The provider's real status and body never reach the response — only
    `SAFE_MESSAGE`. No logging here: each failure already logged exactly
    once at its raise site (`HttpLLMClient._log_failure` or
    `ai.deps.run_cancellable`'s cancellation log) — logging again here
    would double it.
    """

    @app.exception_handler(LLMUnavailableError)
    async def _handle_llm_unavailable(
        request: Request, exc: LLMUnavailableError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=503, content={"code": "AI_UNAVAILABLE", "message": SAFE_MESSAGE}
        )
