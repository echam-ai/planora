"""Pure business-rule modules — no I/O (binding rule 5).

Every module under this package takes plain field values and, where a
result depends on the current instant, a reference time supplied by the
caller. None of them may import `sqlalchemy`, `fastapi`,
`planora_api.db`, `planora_api.config`, or any network, file, or
time-reading module — `tests/unit/test_domain_purity.py` enforces this by
inspecting each module's imports.
"""

from __future__ import annotations
