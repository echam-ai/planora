from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="Planora API")

    @app.get("/api/v1/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app
