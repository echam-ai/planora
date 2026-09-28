"""Unit tests for `ai.fake.FakeLLMClient` (issue #37) — the scripted,
recording fake #38-#41 reuse for their own tests.
"""

from __future__ import annotations

import asyncio

import pytest

from planora_api.ai.client import LLMCompletion, LLMUnavailableError
from planora_api.ai.fake import BLOCK, FakeLLMClient


def _run(coro: object) -> object:
    return asyncio.run(coro)  # type: ignore[arg-type]


def test_scripted_completion_is_returned_and_the_call_is_recorded() -> None:
    completion = LLMCompletion(content="Hi there", tool_calls=(), finish_reason="stop", usage=None)
    fake = FakeLLMClient([completion])

    async def scenario() -> LLMCompletion:
        return await fake.complete(
            [{"role": "user", "content": "Hi"}],
            model="m",
            response_format={"type": "text"},
            tools=None,
            tool_choice="auto",
        )

    result = _run(scenario())
    assert result is completion
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call.messages == [{"role": "user", "content": "Hi"}]
    assert call.model == "m"
    assert call.response_format == {"type": "text"}
    assert call.tools is None
    assert call.tool_choice == "auto"


def test_scripted_error_is_raised() -> None:
    error = LLMUnavailableError("timeout")
    fake = FakeLLMClient([error])

    async def scenario() -> None:
        await fake.complete([{"role": "user", "content": "Hi"}], model="m")

    with pytest.raises(LLMUnavailableError) as exc_info:
        _run(scenario())
    assert exc_info.value is error
    assert exc_info.value.reason == "timeout"


def test_multiple_scripted_steps_are_consumed_in_order() -> None:
    first = LLMCompletion(content="first", tool_calls=(), finish_reason="stop", usage=None)
    second = LLMCompletion(content="second", tool_calls=(), finish_reason="stop", usage=None)
    fake = FakeLLMClient([first, second])

    async def scenario() -> list[LLMCompletion]:
        one = await fake.complete([], model="m")
        two = await fake.complete([], model="m")
        return [one, two]

    results = _run(scenario())
    assert results == [first, second]
    assert len(fake.calls) == 2


def test_exhausted_script_fails_loudly() -> None:
    fake = FakeLLMClient([])

    async def scenario() -> None:
        await fake.complete([{"role": "user", "content": "Hi"}], model="m")

    with pytest.raises(AssertionError):
        _run(scenario())


def test_block_sentinel_has_a_readable_repr() -> None:
    assert repr(BLOCK) == "FakeLLMClient.BLOCK"


def test_block_step_hangs_until_cancelled_and_records_it() -> None:
    fake = FakeLLMClient([BLOCK])

    async def scenario() -> None:
        task = asyncio.ensure_future(fake.complete([{"role": "user", "content": "Hi"}], model="m"))
        # Give the task a chance to actually start awaiting the block —
        # deterministic via a loop yield, not a timed sleep: the task is
        # guaranteed to have entered `await asyncio.Event().wait()` after
        # one full round-trip through the event loop, because nothing else
        # runs concurrently in this test.
        await asyncio.sleep(0)
        assert not task.done()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    _run(scenario())
    assert fake.cancelled_calls == 1
