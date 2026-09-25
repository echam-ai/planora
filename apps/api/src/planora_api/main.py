from fastapi import FastAPI

from planora_api.config import load_settings


def create_app() -> FastAPI:
    # Fail fast: raises ConfigurationError before any route exists if
    # required configuration is missing or invalid.
    settings = load_settings()

    app = FastAPI(title="Planora API")
    app.state.settings = settings

    @app.get("/api/v1/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
