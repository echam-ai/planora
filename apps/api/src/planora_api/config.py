"""Server configuration: the shared site password, the cookie-signing secret,
the LLM key and the public origin are all required (issue #124).

`APP_PASSWORD` is the single shared password in front of the profile chooser;
`SESSION_SECRET` signs the stateless access cookie. Neither has a default, and
neither ever appears in a repr, an error message or a log line.
"""
from __future__ import annotations

from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from planora_api.domain.llm_models import available_models

# Maps each pydantic field name to the environment variable it is read from,
# so error messages can always name the variable an operator actually sets.
_ENV_VAR_NAMES: dict[str, str] = {
    "database_url": "DATABASE_URL",
    "app_password": "APP_PASSWORD",
    "session_secret": "SESSION_SECRET",
    "llm_base_url": "LLM_BASE_URL",
    "llm_api_key": "LLM_API_KEY",
    "llm_model": "LLM_MODEL",
    "llm_allowed_models": "LLM_ALLOWED_MODELS",
    "app_origin": "APP_ORIGIN",
    "default_timezone": "DEFAULT_TIMEZONE",
    "log_level": "LOG_LEVEL",
}

# Field names whose values must never appear in a repr()/str() of Settings.
_SECRET_FIELDS: tuple[str, ...] = ("app_password", "session_secret", "llm_api_key")

APP_PASSWORD_MIN_LENGTH = 12
SESSION_SECRET_MIN_LENGTH = 32


class ConfigurationError(RuntimeError):
    """Raised when required configuration is missing or invalid.

    The message names every offending environment variable and never
    includes a secret's value.
    """


def _checked_secret(value: str, minimum: int) -> str:
    # The messages never include `value`: pydantic's own `input_value` is
    # dropped by `load_settings`, which renders only `error["msg"]`.
    if value.strip() == "":
        raise ValueError("must not be blank")
    if len(value) < minimum:
        raise ValueError(f"must be at least {minimum} characters")
    return value


class Settings(BaseSettings):
    """Configuration read from the environment (and optionally `.env`).

    A real environment variable always takes precedence over a value in a
    local `.env` file — this is pydantic-settings' default source order —
    so the test suite is unaffected by a developer's `apps/api/.env`.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite:///./planora.db"
    app_password: str
    session_secret: str
    llm_base_url: str = "https://api.moonshot.ai/v1"
    llm_api_key: str
    llm_model: str = "kimi-k3"
    # Optional comma-separated extra model names the user may choose in
    # Settings (issue #86). Never exposed except via `available_models`.
    llm_allowed_models: str = ""
    app_origin: str
    default_timezone: str = "Asia/Singapore"
    log_level: str = "INFO"

    @field_validator("llm_api_key")
    @classmethod
    def _secret_must_not_be_blank(cls, value: str) -> str:
        if value.strip() == "":
            raise ValueError("must not be blank")
        return value

    @field_validator("app_password")
    @classmethod
    def _password_is_long_enough(cls, value: str) -> str:
        return _checked_secret(value, APP_PASSWORD_MIN_LENGTH)

    @field_validator("session_secret")
    @classmethod
    def _session_secret_is_long_enough(cls, value: str) -> str:
        return _checked_secret(value, SESSION_SECRET_MIN_LENGTH)

    @field_validator("default_timezone")
    @classmethod
    def _timezone_must_be_iana(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("must be a valid IANA timezone name") from exc
        return value

    @field_validator("app_origin")
    @classmethod
    def _origin_must_be_bare(cls, value: str) -> str:
        parts = urlsplit(value)
        # A bare origin is scheme + host [+ port] only — no path (including
        # a trailing slash), query or fragment — because #26 compares the
        # request Origin header against this value exactly.
        is_bare_origin = (
            parts.scheme in ("http", "https")
            and parts.netloc != ""
            and parts.path == ""
            and parts.query == ""
            and parts.fragment == ""
        )
        if not is_bare_origin:
            raise ValueError(
                "must be a bare http(s) origin with no path, query or fragment"
            )
        return value

    @field_validator("log_level")
    @classmethod
    def _log_level_is_supported(cls, value: str) -> str:
        normalized = value.upper()
        if normalized not in {"DEBUG", "INFO", "WARNING", "ERROR"}:
            raise ValueError("must be DEBUG, INFO, WARNING, or ERROR")
        return normalized

    def available_models(self) -> list[str]:
        """`LLM_MODEL` first, then each `LLM_ALLOWED_MODELS` entry not
        already listed (see `domain.llm_models`)."""
        return available_models(self.llm_model, self.llm_allowed_models)

    def __repr__(self) -> str:
        data = self.model_dump()
        for name in _SECRET_FIELDS:
            if name in data:
                data[name] = "***REDACTED***"
        rendered = ", ".join(f"{key}={value!r}" for key, value in data.items())
        return f"Settings({rendered})"

    __str__ = __repr__


def load_settings() -> Settings:
    """Load `Settings` from the environment, failing fast with a clear error.

    Raises `ConfigurationError` naming every missing or invalid variable. If
    required values are absent, one error names all of them. The message never
    includes a secret's value — only field names invalid for a reason other
    than the secret itself ever appear.
    """
    try:
        return Settings()
    except ValidationError as exc:
        problems = []
        for error in exc.errors():
            field_name = str(error["loc"][0])
            env_var = _ENV_VAR_NAMES.get(field_name, field_name.upper())
            problems.append(f"{env_var}: {error['msg']}")
        message = "Invalid configuration - " + "; ".join(problems)
        raise ConfigurationError(message) from None
