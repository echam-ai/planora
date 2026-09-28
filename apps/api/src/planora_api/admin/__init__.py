"""Administrative commands run directly on the VPS, never through the HTTP
API (spec §19.2, issue #33).

Like `planora_api.jobs`, deliberately never imported by `planora_api.main`
or anything under `planora_api.api`.
"""

from __future__ import annotations
