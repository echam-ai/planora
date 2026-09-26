"""Unit tests for `planora_api.security.csrf.normalize_origin` (issue #26).

Pure string normalization, no I/O: exercised directly rather than through
the middleware/app so the boundary cases are cheap to enumerate. The
integration behavior of `CSRFOriginMiddleware` itself lives in
`tests/integration/test_csrf.py`.
"""

from __future__ import annotations

import pytest

from planora_api.security.csrf import normalize_origin


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # Already normalized — round-trips unchanged.
        ("https://planora.example", "https://planora.example"),
        ("http://localhost:3000", "http://localhost:3000"),
        # Scheme and host casing is lowercased.
        ("https://PLANORA.example", "https://planora.example"),
        ("HTTPS://planora.example", "https://planora.example"),
        ("https://Planora.Example:443", "https://planora.example"),
        # A default port is dropped for its own scheme...
        ("https://planora.example:443", "https://planora.example"),
        ("http://planora.example:80", "http://planora.example"),
        # ...but kept when it isn't the default for that scheme, and kept
        # for a non-default port regardless of scheme.
        ("http://planora.example:443", "http://planora.example:443"),
        ("https://planora.example:80", "https://planora.example:80"),
        ("http://localhost:5173", "http://localhost:5173"),
        # A bare origin with no port at all is unaffected.
        ("http://203.0.113.5", "http://203.0.113.5"),
    ],
)
def test_normalize_origin(raw: str, expected: str) -> None:
    assert normalize_origin(raw) == expected


def test_normalize_origin_is_idempotent() -> None:
    raw = "https://Planora.Example:443"
    once = normalize_origin(raw)
    twice = normalize_origin(once)
    assert once == twice == "https://planora.example"
