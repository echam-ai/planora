"""Unit tests for `security.password` (issue #25) — pure Argon2id hashing,
no database and no FastAPI involved."""

from __future__ import annotations

from planora_api.security.password import (
    DUMMY_PASSWORD_HASH,
    hash_password,
    needs_rehash,
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
    assert DUMMY_PASSWORD_HASH.startswith("$argon2id$")


def test_dummy_password_hash_never_verifies_a_real_login_attempt() -> None:
    assert verify_password(DUMMY_PASSWORD_HASH, "whatever the caller typed") is False


def test_needs_rehash_is_false_for_a_hash_just_produced() -> None:
    hashed = hash_password("correct horse battery staple")

    assert needs_rehash(hashed) is False
