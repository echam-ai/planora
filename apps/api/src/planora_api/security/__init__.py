"""Security-adjacent code: the shared site password gate (issue #124).

Unlike `domain/`, these modules are allowed to do I/O (crypto, in-memory
state, the ASGI request) — that is exactly why they live outside `domain/`
rather than in it (binding rule 5).
"""

from __future__ import annotations
