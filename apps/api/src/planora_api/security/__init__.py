"""Security-adjacent I/O: password hashing, sessions and login rate limiting.

Unlike `domain/`, these modules are allowed to do I/O (crypto, database
reads/writes) — that is exactly why they live outside `domain/` rather than
in it (binding rule 5).
"""

from __future__ import annotations
