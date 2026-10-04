"""Every scoped operation documents profile validation, mutation origin and
the site-password gate (issue #124)."""
import pytest

from planora_api.main import create_app

_AUTH_RESPONSES = {
    ("/api/v1/auth/login", "post"): {"200", "401", "403", "422", "429"},
    ("/api/v1/auth/logout", "post"): {"204", "403"},
    ("/api/v1/auth/session", "get"): {"200"},
}


@pytest.fixture
def app(valid_env):
    built = create_app()
    try:
        yield built
    finally:
        built.state.session_factory.kw["bind"].dispose()


def _ref(operation, status):
    return operation["responses"][status]["content"]["application/json"]["schema"]["$ref"]


def test_scoped_operations_require_documented_profile_header_and_401(app):
    scoped = 0
    for path, operations in app.openapi()["paths"].items():
        for method, operation in operations.items():
            if (path, method) in _AUTH_RESPONSES or path == "/api/v1/health":
                continue
            # Every gated route documents the access gate's 401.
            assert _ref(operation, "401").endswith("/ErrorResponse"), (method, path)
            if method.upper() in {"POST", "PATCH", "PUT", "DELETE"}:
                assert _ref(operation, "403").endswith("/ErrorResponse")
            if path == "/api/v1/profiles":
                assert set(operation["responses"]) == {"200", "401"}
                continue
            scoped += 1
            header = next(p for p in operation["parameters"] if p["name"] == "X-Planora-Profile")
            assert header["required"] is True and header["in"] == "header"
            assert _ref(operation, "422").endswith("/ErrorResponse")
    assert scoped > 0
    assert app.openapi()["components"]["schemas"]["ProfileId"]["enum"] == ["hamster_knight", "ech_princess"]


def test_health_is_public_and_documents_only_200(app):
    assert set(app.openapi()["paths"]["/api/v1/health"]["get"]["responses"]) == {"200"}


def test_auth_operations_document_their_status_codes_and_need_no_profile(app):
    paths = app.openapi()["paths"]
    for (path, method), expected in _AUTH_RESPONSES.items():
        operation = paths[path][method]
        assert set(operation["responses"]) == expected, path
        assert not any(p["name"] == "X-Planora-Profile" for p in operation.get("parameters", []))
        for status in expected - {"200", "204", "422"}:
            assert _ref(operation, status).endswith("/ErrorResponse")
    login = paths["/api/v1/auth/login"]["post"]
    assert _ref(login, "422").endswith("/ErrorResponse")
    assert login["requestBody"]["content"]["application/json"]["schema"]["$ref"].endswith("/LoginRequest")
    schemas = app.openapi()["components"]["schemas"]
    assert schemas["LoginRequest"]["required"] == ["password"]
    assert schemas["AccessResponse"]["required"] == ["authenticated"]
    assert schemas["AccessResponse"]["properties"]["authenticated"]["type"] == "boolean"


def test_only_the_three_auth_operations_exist(app):
    auth = {p for p in app.openapi()["paths"] if "/auth/" in p}
    assert auth == {"/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/auth/session"}
    assert not any(path.endswith("/password") for path in app.openapi()["paths"])


def test_error_response_and_validation_envelope_still_registered(app):
    assert {"ErrorResponse", "ValidationErrorDetail"} <= app.openapi()["components"]["schemas"].keys()
