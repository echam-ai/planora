from fastapi import FastAPI

from planora_api.api.v1.auth import router as auth_router
from planora_api.config import load_settings
from planora_api.db.session import create_session_factory
from planora_api.errors import register_error_handlers
from planora_api.security.csrf import CSRFOriginMiddleware, normalize_origin


def create_app() -> FastAPI:
    # Fail fast: raises ConfigurationError before any route exists if
    # required configuration is missing or invalid.
    settings = load_settings()

    app = FastAPI(title="Planora API")
    app.state.settings = settings
    app.state.session_factory = create_session_factory(settings)

    # App-wide: covers every route below, including ones added later, and
    # runs before routing, authentication, rate limiting and body parsing
    # (issue #26) — registered before any router so a foreign-origin
    # request never reaches one.
    app.add_middleware(
        CSRFOriginMiddleware, expected_origin=normalize_origin(settings.app_origin)
    )

    register_error_handlers(app)
    app.include_router(auth_router)

    @app.get("/api/v1/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
