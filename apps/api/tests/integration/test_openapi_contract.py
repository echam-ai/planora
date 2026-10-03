"""Every scoped operation documents profile validation and mutation origin."""
import pytest

from planora_api.main import create_app


@pytest.fixture
def app(valid_env):
    built = create_app()
    try:
        yield built
    finally:
        built.state.session_factory.kw["bind"].dispose()


def test_scoped_operations_require_documented_profile_header(app):
    scoped = 0
    for path, operations in app.openapi()["paths"].items():
        for method, operation in operations.items():
            assert "401" not in operation["responses"]
            if method.upper() in {"POST", "PATCH", "PUT", "DELETE"}:
                assert "403" in operation["responses"]
                assert operation["responses"]["403"]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")
            if path in {"/api/v1/health", "/api/v1/profiles"}:
                assert set(operation["responses"]) == {"200"}
                continue
            scoped += 1
            header = next(p for p in operation["parameters"] if p["name"] == "X-Planora-Profile")
            assert header["required"] is True and header["in"] == "header"
            assert operation["responses"]["422"]["content"]["application/json"]["schema"]["$ref"].endswith("/ErrorResponse")
    assert scoped > 0
    assert app.openapi()["components"]["schemas"]["ProfileId"]["enum"] == ["hamster_knight", "ech_princess"]


def test_retired_authentication_operations_are_absent(app):
    assert not any("/auth/" in path or path.endswith("/password") for path in app.openapi()["paths"])


def test_error_response_and_validation_envelope_still_registered(app):
    assert {"ErrorResponse", "ValidationErrorDetail"} <= app.openapi()["components"]["schemas"].keys()
