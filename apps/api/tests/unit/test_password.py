"""Unit tests for `security.password` (issue #25) — pure Argon2id hashing,
no database and no FastAPI involved."""

from __future__ import annotations

import pytest

from planora_api.security.password import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    dummy_password_hash,
    hash_password,
    needs_rehash,
    password_length_is_valid,
    verify_password,
)


def test_hash_password_returns_an_argon2id_phc_string() -> None:
    hashed = hash_password("correct horse battery staple")

    assert hashed.startswith("$argon2id$")


def test_verify_password_accepts_the_correct_password() -> None:
    hashed = hash_password("correct horse battery staple")

    assert verify_password(hashed, "correct horse battery staple") is True


def test_verify_password_rejects_any_other_password() -> None:
    hashed = hash_password("correct horse battery staple")

    assert verify_password(hashed, "wrong password") is False


def test_verify_password_rejects_garbage_hash_without_raising() -> None:
    assert verify_password("not-an-argon2-hash", "anything") is False


def test_dummy_password_hash_is_a_real_argon2id_hash() -> None:
    assert dummy_password_hash().startswith("$argon2id$")


def test_dummy_password_hash_never_verifies_a_real_login_attempt() -> None:
    assert verify_password(dummy_password_hash(), "whatever the caller typed") is False


def test_needs_rehash_is_false_for_a_hash_just_produced() -> None:
    hashed = hash_password("correct horse battery staple")

    assert needs_rehash(hashed) is False


# --- Shared password length rule (#31, #33) ---------------------------------


def test_length_constants_are_six_to_1024() -> None:
    assert MIN_PASSWORD_LENGTH == 6
    assert MAX_PASSWORD_LENGTH == 1024


@pytest.mark.parametrize(
    ("length", "expected"),
    [
        (5, False),
        (6, True),
        (1024, True),
        (1025, False),
    ],
)
def test_password_length_is_valid_at_the_boundaries(length: int, expected: bool) -> None:
    assert password_length_is_valid("a" * length) is expected


def test_password_length_is_valid_never_trims_whitespace() -> None:
    # 5 spaces + 1 real character = 6 raw characters: valid by raw length,
    # even though a trimmed comparison would see something shorter.
    assert password_length_is_valid("     x") is True
    # A password that is only whitespace still counts by raw length.
    assert password_length_is_valid(" " * 6) is True
    assert password_length_is_valid(" " * 5) is False
