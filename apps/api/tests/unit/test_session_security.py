"""Unit tests for the pure parts of `security.session` (issue #25):
token/digest generation and the `Secure` cookie-flag rule. Anything that
touches the database (`create_session`, `get_valid_session`,
`delete_session`) is exercised in `tests/integration/test_auth_storage.py`
instead."""

from __future__ import annotations

import pytest

from planora_api.security.session import cookie_is_secure, generate_token, hash_token


def test_generate_token_returns_distinct_values() -> None:
    assert generate_token() != generate_token()


def test_hash_token_is_deterministic_for_the_same_token_and_secret() -> None:
    token = generate_token()

    assert hash_token(token, "secret-a") == hash_token(token, "secret-a")


def test_hash_token_differs_across_secrets() -> None:
    token = generate_token()

    assert hash_token(token, "secret-a") != hash_token(token, "secret-b")


def test_hash_token_never_contains_the_raw_token() -> None:
    token = generate_token()

    assert token not in hash_token(token, "secret-a")


@pytest.mark.parametrize(
    "app_origin",
    [
        "https://planora.example",  # production https
        "http://203.0.113.5",  # bare http, but not localhost/127.0.0.1
        "https://localhost:3000",  # https even on localhost
    ],
)
def test_cookie_is_secure_for_non_local_http_or_any_https_origin(app_origin: str) -> None:
    assert cookie_is_secure(app_origin) is True


@pytest.mark.parametrize(
    "app_origin",
    [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost",
        "http://127.0.0.1",
    ],
)
def test_cookie_is_not_secure_for_bare_http_localhost_or_loopback(app_origin: str) -> None:
    assert cookie_is_secure(app_origin) is False
