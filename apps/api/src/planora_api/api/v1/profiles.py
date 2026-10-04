"""Fixed profile catalog. Behind the shared site password (issue #124), but
still no per-profile login, identity or mutable accounts."""
from fastapi import APIRouter

from planora_api.errors import UNAUTHENTICATED_RESPONSE
from planora_api.schemas.profile import ProfileId, ProfileResponse

router = APIRouter(
    prefix="/api/v1/profiles", tags=["profiles"], responses=UNAUTHENTICATED_RESPONSE
)


@router.get("", response_model=list[ProfileResponse])
def list_profiles() -> list[ProfileResponse]:
    return [
        ProfileResponse(id=ProfileId.HAMSTER_KNIGHT, name="Hamster Knight"),
        ProfileResponse(id=ProfileId.ECH_PRINCESS, name="Ech Princess"),
    ]
