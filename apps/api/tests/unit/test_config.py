"""Tests for `planora_api.config` — fail-fast environment configuration."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from conftest import VALID_ENV

from planora_api.config import ConfigurationError, Settings, load_settings

SENTINEL = "sentinel-do-not-print"

# apps/api/.env.example — the tracked template a developer copies to .env.
_ENV_EXAMPLE_PATH = Path(__file__).resolve().parents[2] / ".env.example"


def test_loads_all_seven_values_when_valid(valid_env: pytest.MonkeyPatch) -> None:
    settings = load_settings()

    assert settings.database_url == VALID_ENV["DATABASE_URL"]
    assert settings.session_secret == VALID_ENV["SESSION_SECRET"]
    assert settings.llm_base_url == VALID_ENV["LLM_BASE_URL"]
    assert settings.llm_api_key == VALID_ENV["LLM_API_KEY"]
    assert settings.llm_model == VALID_ENV["LLM_MODEL"]
    assert settings.app_origin == VALID_ENV["APP_ORIGIN"]
    assert settings.default_timezone == VALID_ENV["DEFAULT_TIMEZONE"]


@pytest.mark.parametrize("secret_name", ["LLM_API_KEY"])
def test_missing_secret_raises_naming_it(
    valid_env: pytest.MonkeyPatch, secret_name: str
) -> None:
    valid_env.delenv(secret_name, raising=False)

    with pytest.raises(ConfigurationError) as exc_info:
        load_settings()

    assert secret_name in str(exc_info.value)


@pytest.mark.parametrize("secret_name", ["LLM_API_KEY"])
@pytest.mark.parametrize("blank_value", ["", "   ", "\t\n"])
def test_blank_secret_treated_as_missing(
    valid_env: pytest.MonkeyPatch, secret_name: str, blank_value: str
) -> None:
    valid_env.setenv(secret_name, blank_value)

    with pytest.raises(ConfigurationError) as exc_info:
        load_settings()

    assert secret_name in str(exc_info.value)


def test_missing_app_origin_raises_naming_it(valid_env: pytest.MonkeyPatch) -> None:
    valid_env.delenv("APP_ORIGIN", raising=False)

    with pytest.raises(ConfigurationError) as exc_info:
        load_settings()

    assert "APP_ORIGIN" in str(exc_info.value)


def test_both_secrets_missing_names_both(valid_env: pytest.MonkeyPatch) -> None:
    valid_env.delenv("SESSION_SECRET", raising=False)
    valid_env.delenv("LLM_API_KEY", raising=False)

    with pytest.raises(ConfigurationError) as exc_info:
        load_settings()

    message = str(exc_info.value)
    assert "SESSION_SECRET" not in message
    assert "LLM_API_KEY" in message


def test_default_timezone_defaults_to_singapore_when_unset(
    valid_env: pytest.MonkeyPatch,
) -> None:
    valid_env.delenv("DEFAULT_TIMEZONE", raising=False)

    settings = load_settings()

    assert settings.default_timezone == "Asia/Singapore"


def test_invalid_timezone_raises_naming_it(valid_env: pytest.MonkeyPatch) -> None:
    valid_env.setenv("DEFAULT_TIMEZONE", "Mars/Olympus")

    with pytest.raises(ConfigurationError) as exc_info:
        load_settings()

    assert "DEFAULT_TIMEZONE" in str(exc_info.value)


@pytest.mark.parametrize(
    "origin",
    [
        "https://planora.example/app",
        "https://planora.example/",
        "ftp://planora.example",
        "planora.example",
        "https://planora.example?query=1",
    ],
)
def test_invalid_app_origin_raises_naming_it(
    valid_env: pytest.MonkeyPatch, origin: str
) -> None:
    valid_env.setenv("APP_ORIGIN", origin)

    with pytest.raises(ConfigurationError) as exc_info:
        load_settings()

    assert "APP_ORIGIN" in str(exc_info.value)


@pytest.mark.parametrize(
    "origin",
    ["https://planora.example", "http://127.0.0.1:8000"],
)
def test_bare_app_origin_is_accepted(
    valid_env: pytest.MonkeyPatch, origin: str
) -> None:
    valid_env.setenv("APP_ORIGIN", origin)

    settings = load_settings()

    assert settings.app_origin == origin


def test_non_secret_defaults_used_when_unset(valid_env: pytest.MonkeyPatch) -> None:
    valid_env.delenv("DATABASE_URL", raising=False)
    valid_env.delenv("LLM_BASE_URL", raising=False)
    valid_env.delenv("LLM_MODEL", raising=False)

    settings = load_settings()

    assert settings.database_url
    assert settings.llm_base_url
    assert settings.llm_model


def test_no_secret_field_has_a_default() -> None:
    fields = Settings.model_fields
    assert not fields["session_secret"].is_required()
    assert fields["llm_api_key"].is_required()


def test_secret_never_appears_in_repr_or_str(valid_env: pytest.MonkeyPatch) -> None:
    valid_env.setenv("SESSION_SECRET", SENTINEL)
    valid_env.setenv("LLM_API_KEY", SENTINEL)

    settings = load_settings()

    assert SENTINEL not in repr(settings)
    assert SENTINEL not in str(settings)


def test_secret_does_not_leak_through_unrelated_error(
    valid_env: pytest.MonkeyPatch,
) -> None:
    valid_env.setenv("LLM_API_KEY", SENTINEL)
    valid_env.setenv("DEFAULT_TIMEZONE", "Mars/Olympus")

    with pytest.raises(ConfigurationError) as exc_info:
        load_settings()

    assert SENTINEL not in str(exc_info.value)
    assert SENTINEL not in repr(exc_info.value)


def test_real_env_var_overrides_dotenv_value(
    tmp_path: object, valid_env: pytest.MonkeyPatch
) -> None:
    monkeypatch = valid_env
    monkeypatch.chdir(tmp_path)  # type: ignore[arg-type]
    dotenv_path = tmp_path / ".env"  # type: ignore[operator]
    dotenv_path.write_text("SESSION_SECRET=from-dotenv-file\n")
    monkeypatch.setenv("SESSION_SECRET", "from-real-env")

    settings = load_settings()

    assert settings.session_secret == "from-real-env"


def test_missing_dotenv_file_does_not_fail(valid_env: pytest.MonkeyPatch) -> None:
    # No apps/api/.env is present in this worktree (it is gitignored); the
    # suite must pass whether or not a developer has created one locally.
    settings = load_settings()

    assert settings.session_secret == VALID_ENV["SESSION_SECRET"]


def test_log_level_defaults_to_info_when_unset(valid_env: pytest.MonkeyPatch) -> None:
    valid_env.delenv("LOG_LEVEL", raising=False)

    settings = load_settings()

    assert settings.log_level == "INFO"


@pytest.mark.parametrize("level", ["DEBUG", "INFO", "WARNING", "ERROR", "debug", "Warning"])
def test_log_level_accepts_the_four_supported_values_case_insensitively(
    valid_env: pytest.MonkeyPatch, level: str
) -> None:
    valid_env.setenv("LOG_LEVEL", level)

    settings = load_settings()

    assert settings.log_level == level.upper()


@pytest.mark.parametrize("level", ["TRACE", "CRITICAL", "verbose", "", "not-a-level"])
def test_invalid_log_level_fails_startup_naming_it(
    valid_env: pytest.MonkeyPatch, level: str
) -> None:
    valid_env.setenv("LOG_LEVEL", level)

    with pytest.raises(ConfigurationError) as exc_info:
        load_settings()

    assert "LOG_LEVEL" in str(exc_info.value)


def test_unedited_env_example_fails_naming_all_three_required_values(
    tmp_path: Path, clean_env: pytest.MonkeyPatch
) -> None:
    # A developer who copies .env.example to .env without filling anything
    # in must be refused at startup, not booted into a broken/insecure
    # config (SESSION_SECRET=change-me, APP_ORIGIN=<blank>, etc.). This
    # loads the tracked template verbatim, with no environment variable
    # overriding it, exactly as `cp .env.example .env` would leave it.
    clean_env.chdir(tmp_path)
    shutil.copyfile(_ENV_EXAMPLE_PATH, tmp_path / ".env")

    with pytest.raises(ConfigurationError) as exc_info:
        load_settings()

    message = str(exc_info.value)
    assert "SESSION_SECRET" not in message
    assert "LLM_API_KEY" in message
    assert "APP_ORIGIN" in message
