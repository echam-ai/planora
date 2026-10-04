"""The stateless signed access cookie value (issue #124, AC7)."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta

import pytest

from planora_api.security import access

SECRET = "s" * 40
PASSWORD = "a-long-enough-password"
T = datetime(2026, 3, 1, 12, 0, 0, tzinfo=UTC)
LIFETIME = timedelta(days=30)


def _issue(now: datetime = T, *, secret: str = SECRET, password: str = PASSWORD) -> str:
    return access.issue_token(session_secret=secret, app_password=password, now=now)


def _valid(token: str | None, now: datetime, *, secret: str = SECRET, password: str = PASSWORD) -> bool:
    return access.verify_token(token, session_secret=secret, app_password=password, now=now)


def test_lifetime_is_exactly_thirty_days() -> None:
    assert access.ACCESS_LIFETIME == LIFETIME
    assert access.COOKIE_NAME == "planora_access"


def test_token_valid_until_one_second_before_expiry() -> None:
    token = _issue()
    assert _valid(token, T)
    assert _valid(token, T + LIFETIME - timedelta(seconds=1))


def test_token_rejected_at_and_after_expiry() -> None:
    token = _issue()
    assert not _valid(token, T + LIFETIME)
    assert not _valid(token, T + LIFETIME + timedelta(days=1))


def test_expiry_holds_for_a_fractional_issue_instant() -> None:
    issued = T + timedelta(microseconds=999_999)
    token = _issue(issued)
    assert _valid(token, issued + LIFETIME - timedelta(seconds=1))
    assert not _valid(token, issued + LIFETIME)


def test_token_carries_neither_secret_nor_unkeyed_hash() -> None:
    token = _issue()
    assert SECRET not in token
    assert PASSWORD not in token
    for value in (SECRET, PASSWORD):
        for algorithm in ("md5", "sha1", "sha256", "sha512"):
            digest = hashlib.new(algorithm, value.encode()).hexdigest()
            assert digest not in token


@pytest.mark.parametrize("position", [0, 5, -1])
def test_tampered_token_is_rejected(position: int) -> None:
    token = _issue()
    chars = list(token)
    chars[position] = "A" if chars[position] != "A" else "B"
    assert not _valid("".join(chars), T)


def test_other_secret_or_password_invalidates() -> None:
    token = _issue()
    assert not _valid(token, T, secret="t" * 40)
    assert not _valid(token, T, password="another-long-password")


def test_signing_depends_on_both_secret_and_password() -> None:
    assert _issue(secret="t" * 40) != _issue()
    assert _issue(password="another-long-password") != _issue()


@pytest.mark.parametrize("junk", [None, "", "abc", "v1.", "v1.x.y", "1.2.3.4", "\x00", "é" * 10])
def test_malformed_values_are_rejected_not_raised(junk: str | None) -> None:
    assert not _valid(junk, T)


def test_far_future_expiry_is_rejected() -> None:
    far_future = _issue(T + timedelta(days=400))
    assert not _valid(far_future, T)


@pytest.mark.parametrize(
    ("origin", "secure"),
    [("https://planora.example", True), ("http://localhost:5173", False)],
)
def test_cookie_is_secure_follows_origin_scheme(origin: str, secure: bool) -> None:
    assert access.cookie_is_secure(origin) is secure


def test_password_matches_uses_constant_time_compare(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[bytes, bytes]] = []
    real = access.hmac.compare_digest

    def spy(a: bytes, b: bytes) -> bool:
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(access.hmac, "compare_digest", spy)
    assert access.password_matches("héllo-password", "héllo-password")
    assert not access.password_matches("wrong", "héllo-password")
    assert len(calls) == 2
