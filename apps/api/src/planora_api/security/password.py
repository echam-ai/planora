"""Argon2id password hashing (issue #25).

Uses `argon2-cffi`'s `PasswordHasher` with its library defaults — the
RFC 9106 low-memory profile pinned at grooming: `time_cost=3`,
`memory_cost=65536` KiB, `parallelism=4`. The stored value is the
self-describing `$argon2id$...` PHC string, so no separate salt or
parameter columns are needed.

`dummy_password_hash()` lets a caller verify against a fixed hash when the
submitted username does not match any account, so an unknown-user login and
a wrong-password login perform the same one Argon2 verification and cost
the same time — the response never reveals whether the username exists.

`MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_LENGTH`/`password_length_is_valid` are
the one shared definition of the 6-to-1024-character rule (spec §3.2),
pinned at #31's grooming and reused unchanged by #33's administrative
reset command — moved here specifically so neither caller can drift from
the other. Passwords are never trimmed before this check.
"""

from __future__ import annotations

from functools import cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()

MIN_PASSWORD_LENGTH = 6
MAX_PASSWORD_LENGTH = 1024

PASSWORD_LENGTH_RULE_MESSAGE = (
    f"Password must be {MIN_PASSWORD_LENGTH} to {MAX_PASSWORD_LENGTH} characters."
)



@cache
def dummy_password_hash() -> str:
    """A hash of a value nobody can ever submit as a real password,
    computed once on first use (not at import). Verifying against it always
    fails, but costs one real Argon2 verification — never returns and never
    logs the value hashed here."""
    return _hasher.hash("planora-unknown-user-dummy-hash-25")


def hash_password(password: str) -> str:
    """Return the Argon2id PHC hash for `password`."""
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Return whether `password` matches `password_hash`.

    Never raises: any invalid hash, mismatch or verification failure is
    reported as `False` rather than propagated, so a caller can treat this
    as a plain predicate.
    """
    try:
        _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHash):
        return False
    return True


def needs_rehash(password_hash: str) -> bool:
    """Return whether `password_hash` should be recomputed under the
    hasher's current parameters (rehash-on-login, issue #25)."""
    return _hasher.check_needs_rehash(password_hash)


def password_length_is_valid(password: str) -> bool:
    """Whether `password`'s raw length satisfies the shared 6-to-1024-
    character rule (spec §3.2) — the one definition `schemas.settings.
    PasswordChangeRequest` (#31) and `admin.reset_password` (#33) both
    check against. `password` is never trimmed first: leading or trailing
    whitespace counts toward the length exactly like any other character.
    """
    return MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH
