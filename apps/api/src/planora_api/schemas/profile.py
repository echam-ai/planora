"""The fixed profile catalog; selection conveys no authentication."""
from enum import Enum

from pydantic import BaseModel


class ProfileId(str, Enum):
    HAMSTER_KNIGHT = "hamster_knight"
    ECH_PRINCESS = "ech_princess"

    @property
    def database_id(self) -> int:
        return 1 if self is ProfileId.HAMSTER_KNIGHT else 2


class ProfileResponse(BaseModel):
    id: ProfileId
    name: str
