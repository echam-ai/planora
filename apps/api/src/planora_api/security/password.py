"""Argon2id password hashing (issue #25).

Uses `argon2-cffi`'s `PasswordHasher` with its library defaults — the
RFC 9106 low-memory profile pinned at grooming: `time_cost=3`,
`memory_cost=65536` KiB, `parallelism=4`. The stored value is the
self-describing `$argon2id$...` PHC string, so no separate salt or
parameter columns are needed.

`DUMMY_PASSWORD_HASH` lets a caller verify against a fixed hash when the
submitted username does not match any account, so an unknown-user login and
a wrong-password login perform the same one Argon2 verification and cost
the same time — the response never reveals whether the username exists.
"""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()

# A hash of a value nobody can ever submit as a real password, computed once
# at import time. Verifying against it always fails, but costs one real
# Argon2 verification — never returns and never logs the value hashed here.
DUMMY_PASSWORD_HASH = _hasher.hash("planora-unknown-user-dummy-hash-25")


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
