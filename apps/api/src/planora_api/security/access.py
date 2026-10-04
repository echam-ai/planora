"""The stateless signed access cookie behind the site password (issue #124).

There is one shared password (`APP_PASSWORD`), not an account. Unlocking sets
a cookie that carries its own expiry and an HMAC over it, so the server keeps
no session table and needs no migration:

    v1.<expiry as unix seconds>.<urlsafe base64 HMAC-SHA256 signature>

The signing key is derived from *both* `SESSION_SECRET` and `APP_PASSWORD`, so
rotating either one invalidates every cookie ever issued. The cookie holds
neither value nor any unkeyed hash of them. Because nothing is stored, Lock
only removes the cookie from one browser; rotating `SESSION_SECRET` is the way
to revoke every copy. The lifetime is fixed at 30 days from unlock and is not
renewed on use.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from datetime import datetime, timedelta
from urllib.parse import urlsplit

COOKIE_NAME = "planora_access"
ACCESS_LIFETIME = timedelta(days=30)
_VERSION = "v1"
_KEY_CONTEXT = b"planora-access-cookie:v1:"


def _signing_key(session_secret: str, app_password: str) -> bytes:
    return hmac.new(
        session_secret.encode("utf-8"),
        _KEY_CONTEXT + app_password.encode("utf-8"),
        hashlib.sha256,
    ).digest()


def _sign(key: bytes, payload: str) -> str:
    digest = hmac.new(key, payload.encode("ascii"), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def issue_token(*, session_secret: str, app_password: str, now: datetime) -> str:
    """A token valid from `now` until exactly 30 days later (whole seconds,
    rounded down, so it never outlives the cookie's own `Max-Age`)."""
    expiry = int(now.timestamp()) + int(ACCESS_LIFETIME.total_seconds())
    payload = f"{_VERSION}.{expiry}"
    return f"{payload}.{_sign(_signing_key(session_secret, app_password), payload)}"


def verify_token(
    token: str | None, *, session_secret: str, app_password: str, now: datetime
) -> bool:
    """True only for an untampered token signed under the current secret and
    password whose expiry is still in the future. Never raises."""
    if not token:
        return False
    try:
        version, expiry_text, signature = token.split(".")
        if version != _VERSION or not expiry_text.isascii() or not expiry_text.isdigit():
            return False
        payload = f"{version}.{expiry_text}"
        expected = _sign(_signing_key(session_secret, app_password), payload)
        if not hmac.compare_digest(signature.encode("ascii"), expected.encode("ascii")):
            return False
        expiry = int(expiry_text)
    except (ValueError, UnicodeError):
        return False
    remaining = expiry - now.timestamp()
    # Reject an expiry beyond one lifetime ahead: only a different clock
    # could have produced it.
    return 0 < remaining <= ACCESS_LIFETIME.total_seconds()


def password_matches(supplied: str, expected: str) -> bool:
    """Constant-time comparison of the supplied password with `APP_PASSWORD`."""
    return hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


def cookie_is_secure(app_origin: str) -> bool:
    """`Secure` exactly when the configured public origin is https."""
    return urlsplit(app_origin).scheme == "https"
