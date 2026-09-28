"""Wire schema for `GET /api/v1/archive` (spec §9.2, issue #30).

`snake_case` field names (binding rule 2), matching the shape the mock
`ApiClient.listArchive` already returns in the web tier (`items`, `total`,
`page`, `page_size` once mapped) so #35 can swap the mock for the HTTP
client without touching a page component (spec acceptance criterion 16).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from planora_api.schemas.task import TaskResponse


class ArchiveListResponse(BaseModel):
    """The full-page shape for `GET /api/v1/archive`."""

    model_config = ConfigDict(extra="forbid")

    items: list[TaskResponse]
    total: int
    page: int
    page_size: int
