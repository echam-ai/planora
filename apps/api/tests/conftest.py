"""Shared fixtures for the API test suite."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

# The seven variable names fixed by #21; #22, #25, #26, #37 and #43 rely on
# these exact names.
ENV_VAR_NAMES: tuple[str, ...] = (
    "DATABASE_URL",
    "SESSION_SECRET",
    "LLM_BASE_URL",
    "LLM_API_KEY",
    "LLM_MODEL",
    "APP_ORIGIN",
    "DEFAULT_TIMEZONE",
)

# A complete, valid configuration a test can start from and selectively
# override or unset.
VALID_ENV: dict[str, str] = {
    "DATABASE_URL": "sqlite:///./test.db",
    "SESSION_SECRET": "test-session-secret",
    "LLM_BASE_URL": "https://llm.example.com/v1",
    "LLM_API_KEY": "test-llm-api-key",
    "LLM_MODEL": "test-model",
    "APP_ORIGIN": "https://planora.example",
    "DEFAULT_TIMEZONE": "Europe/Paris",
}


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    """Remove all seven configuration variables from the environment.

    Prevents a developer's real shell environment from leaking into a test
    that wants to control every value explicitly.
    """
    for name in ENV_VAR_NAMES:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


@pytest.fixture
def valid_env(clean_env: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    """Set all seven configuration variables to valid values."""
    for name, value in VALID_ENV.items():
        clean_env.setenv(name, value)
    yield clean_env
