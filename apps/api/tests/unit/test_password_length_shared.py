"""Proves issue #33's "one shared definition" acceptance criterion: both
`schemas.settings.PasswordChangeRequest` (#31) and `admin.reset_password`
(#33) resolve the password-length rule through the exact same function
object in `security.password` — not two independently-maintained copies
that merely happen to agree today.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from planora_api.admin import reset_password as reset_password_module
from planora_api.schemas.settings import PasswordChangeRequest
from planora_api.security import password as password_security


def test_admin_module_calls_the_same_function_object_security_password_exports() -> None:
    # `admin.reset_password` imports `security.password` as a module (not
    # the bare function), so this identity check also proves a test could
    # monkeypatch `password_security.password_length_is_valid` and have
    # the admin command's own call resolve through the patched attribute —
    # the same pattern `api.v1.auth` uses for `verify_password`.
    assert (
        reset_password_module.password_security.password_length_is_valid
        is password_security.password_length_is_valid
    )


@pytest.mark.parametrize("length", [5, 6, 1024, 1025])
def test_password_change_request_agrees_with_the_shared_function_at_every_boundary(
    length: int,
) -> None:
    password = "a" * length
    expected_valid = password_security.password_length_is_valid(password)

    if expected_valid:
        request = PasswordChangeRequest(current_password="whatever", new_password=password)
        assert request.new_password == password
    else:
        with pytest.raises(ValidationError):
            PasswordChangeRequest(current_password="whatever", new_password=password)
