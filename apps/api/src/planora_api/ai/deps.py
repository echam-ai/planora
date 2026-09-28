"""FastAPI dependency and cancellation helper for the LLM client (issue
#37, spec §15.2: "AI requests show an immediate progress state and support
cancellation").
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Coroutine
from typing import Any

from fastapi import Request

from planora_api.ai.client import LLMClient, LLMUnavailableError

logger = logging.getLogger("planora_api.ai.deps")

# How often `run_cancellable` polls `request.is_disconnected()` while the
# wrapped call is still in flight. A test may monkeypatch this to poll
# faster instead of waiting on the real interval.
_POLL_INTERVAL = 0.5


def get_llm_client(request: Request) -> LLMClient:
    """The app's shared LLM client, bound to one lifespan-managed
    `httpx.AsyncClient` (see `main.create_app`'s lifespan: opened at
    startup, closed at shutdown, never per-request).

    Tests replace this with `app.dependency_overrides[get_llm_client]` —
    usually an `ai.fake.FakeLLMClient` — instead of exercising the real
    HTTP implementation.
    """
    return request.app.state.llm_client


async def run_cancellable[T](request: Request, coro: Coroutine[Any, Any, T]) -> T:
    """Run `coro` (typically an `LLMClient.complete(...)` call), cancelling
    it if `request` disconnects mid-flight.

    Polls `request.is_disconnected()` about every `_POLL_INTERVAL` seconds
    while `coro` is still running. On disconnect, cancels the in-flight
    task — closing any underlying HTTP request inside it — and raises
    `LLMUnavailableError(reason="cancelled")` instead of returning a
    result. Consumers must not write anything after this raises.
    """
    started = time.perf_counter()
    task: asyncio.Task[T] = asyncio.ensure_future(coro)
    while True:
        done, _pending = await asyncio.wait({task}, timeout=_POLL_INTERVAL)
        if task in done:
            return task.result()
        if await request.is_disconnected():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            logger.warning(
                "llm_request_failed",
                extra={
                    "reason": "cancelled",
                    "status": None,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 3),
                },
            )
            raise LLMUnavailableError("cancelled") from None
