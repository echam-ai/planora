import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from planora_api.main import create_app


def test_health_returns_ok(valid_env: pytest.MonkeyPatch):
    async def request_health():
        async with AsyncClient(
            transport=ASGITransport(app=create_app()), base_url="http://test"
        ) as client:
            return await client.get("/api/v1/health")

    response = asyncio.run(request_health())

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"status": "ok"}
