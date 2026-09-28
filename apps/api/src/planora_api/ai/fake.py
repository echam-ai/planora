"""A scripted, recording fake `LLMClient` (issue #37) — reused by #38-#41's
own tests so nothing there re-implements a mock provider.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from planora_api.ai.client import LLMCompletion, LLMUnavailableError


class _Block:
    """Sentinel script step: the call hangs (awaits forever) until the
    awaiting task is cancelled — for testing `ai.deps.run_cancellable`."""

    def __repr__(self) -> str:
        return "FakeLLMClient.BLOCK"


BLOCK = _Block()

FakeStep = LLMCompletion | LLMUnavailableError | _Block


@dataclass(frozen=True)
class RecordedCall:
    """One call `FakeLLMClient.complete()` received, for test assertions."""

    messages: list[Mapping[str, Any]]
    model: str
    response_format: Mapping[str, Any] | None
    tools: Sequence[Mapping[str, Any]] | None
    tool_choice: Any | None


class FakeLLMClient:
    """Implements `ai.client.LLMClient` from a scripted queue of steps —
    each one an `LLMCompletion`, a raised `LLMUnavailableError`, or `BLOCK`.
    Every call is recorded in `.calls`, in order; an exhausted script fails
    loudly (`AssertionError`) instead of returning something unscripted.
    """

    BLOCK = BLOCK

    def __init__(self, script: Sequence[FakeStep]) -> None:
        self._script: list[FakeStep] = list(script)
        self.calls: list[RecordedCall] = []
        self.cancelled_calls = 0

    async def complete(
        self,
        messages: Sequence[Mapping[str, Any]],
        *,
        model: str,
        response_format: Mapping[str, Any] | None = None,
        tools: Sequence[Mapping[str, Any]] | None = None,
        tool_choice: Any | None = None,
    ) -> LLMCompletion:
        self.calls.append(
            RecordedCall(list(messages), model, response_format, tools, tool_choice)
        )
        if not self._script:
            raise AssertionError(
                "FakeLLMClient script exhausted — add another scripted step "
                "for this call"
            )
        step = self._script.pop(0)

        if step is BLOCK:
            try:
                await asyncio.Event().wait()  # never resolves on its own
            except asyncio.CancelledError:
                self.cancelled_calls += 1
                raise

        if isinstance(step, LLMUnavailableError):
            raise step

        assert isinstance(step, LLMCompletion)
        return step
