"""LLM integration (spec §19.2, issue #37): a thin, non-streaming HTTP
client for the configured OpenAI-compatible endpoint, prompt/content
redaction for logging, a scripted fake for deterministic tests, and the
FastAPI dependency + cancellation helper that bind them into the app.

This package adds no product endpoint — #38-#41 are the consumers.
"""

from __future__ import annotations
