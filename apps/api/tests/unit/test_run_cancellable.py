"""Unit tests for `ai.deps.run_cancellable` (issue #37, spec §15.2).

Cancellation is proven with `asyncio.Event`s, never a fixed-duration
`sleep` race: the fake "request" reports disconnected only once told to
(`disconnect_event.set()`), and that is only ever set after the wrapped
call has provably started (`call_started.wait()`) — so timing never
depends on how fast the event loop happens to run. `_POLL_INTERVAL` is
monkeypatched small so the whole test finishes in well under the
1-second bound the acceptance criterion sets, without ever needing a real
0.2s/1s wall-clock wait.
"""

from __future__ import annotations

import asyncio
import logging
import time

import pytest

from planora_api.ai import deps as ai_deps
from planora_api.ai.client import LLMUnavailableError


class _FakeRequest:
    """A minimal stand-in for `fastapi.Request`: only `is_disconnected()`
    is used by `run_cancellable`."""

    def __init__(self, disconnect_event: asyncio.Event) -> None:
        self._event = disconnect_event

    async def is_disconnected(self) -> bool:
        return self._event.is_set()


def _run(coro: object) -> object:
    return asyncio.run(coro)  # type: ignore[arg-type]


def test_returns_the_result_when_the_call_finishes_before_any_disconnect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ai_deps, "_POLL_INTERVAL", 0.01)

    async def scenario() -> str:
        never_disconnects = asyncio.Event()
        request = _FakeRequest(never_disconnects)

        async def quick_call() -> str:
            return "done"

        return await ai_deps.run_cancellable(request, quick_call())

    result = _run(scenario())
    assert result == "done"


def test_polls_more_than_once_when_the_call_outlasts_one_interval_but_never_disconnects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Exercises the "not disconnected yet, loop again" branch: the call
    takes longer than one poll interval but completes before any
    disconnect, so `run_cancellable` must poll `is_disconnected()`,
    observe `False`, and loop back rather than returning or raising."""
    monkeypatch.setattr(ai_deps, "_POLL_INTERVAL", 0.01)

    async def scenario() -> tuple[str, int]:
        never_disconnects = asyncio.Event()
        poll_count = 0
        request = _FakeRequest(never_disconnects)

        real_is_disconnected = request.is_disconnected

        async def counting_is_disconnected() -> bool:
            nonlocal poll_count
            poll_count += 1
            return await real_is_disconnected()

        request.is_disconnected = counting_is_disconnected  # type: ignore[method-assign]

        async def slow_call() -> str:
            # Outlasts several 0.01s poll intervals, so `run_cancellable`
            # must loop at least twice before this resolves.
            for _ in range(5):
                await asyncio.sleep(0.01)
            return "done"

        result = await ai_deps.run_cancellable(request, slow_call())
        return result, poll_count

    result, poll_count = _run(scenario())
    assert result == "done"
    assert poll_count >= 2


def test_cancels_and_raises_within_one_second_of_disconnect(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(ai_deps, "_POLL_INTERVAL", 0.02)
    caplog.set_level(logging.DEBUG)

    async def scenario() -> tuple[LLMUnavailableError, float]:
        disconnect_event = asyncio.Event()
        call_started = asyncio.Event()
        was_cancelled = asyncio.Event()
        request = _FakeRequest(disconnect_event)

        async def blocking_call() -> None:
            call_started.set()
            try:
                await asyncio.Event().wait()  # never resolves on its own
            except asyncio.CancelledError:
                was_cancelled.set()
                raise

        async def disconnect_once_the_call_has_actually_started() -> None:
            await call_started.wait()
            disconnect_event.set()

        asyncio.ensure_future(disconnect_once_the_call_has_actually_started())

        started = time.perf_counter()
        with pytest.raises(LLMUnavailableError) as exc_info:
            await ai_deps.run_cancellable(request, blocking_call())
        elapsed = time.perf_counter() - started

        assert was_cancelled.is_set()
        return exc_info.value, elapsed

    exc, elapsed = _run(scenario())
    assert exc.reason == "cancelled"
    assert exc.status is None
    assert elapsed < 1.0

    failed_records = [r for r in caplog.records if r.getMessage() == "llm_request_failed"]
    assert len(failed_records) == 1
    assert failed_records[0].levelno == logging.WARNING
    assert failed_records[0].reason == "cancelled"


def test_ensure_request_connected_passes_while_the_client_is_connected() -> None:
    async def scenario() -> None:
        await ai_deps.ensure_request_connected(_FakeRequest(asyncio.Event()))  # type: ignore[arg-type]

    _run(scenario())


def test_ensure_request_connected_raises_cancelled_once_the_client_is_gone(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)

    async def scenario() -> None:
        gone = asyncio.Event()
        gone.set()
        await ai_deps.ensure_request_connected(_FakeRequest(gone))  # type: ignore[arg-type]

    with pytest.raises(LLMUnavailableError) as exc_info:
        _run(scenario())

    assert exc_info.value.reason == "cancelled"
    records = [r for r in caplog.records if r.getMessage() == "request_cancelled_before_save"]
    assert len(records) == 1
    assert records[0].levelno == logging.WARNING
