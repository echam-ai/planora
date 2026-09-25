"""Integration check that uvicorn itself fails fast on bad configuration.

`create_app()` raising `ConfigurationError` is covered at the unit level
(`tests/unit/test_config.py`). This test exercises the real entrypoint the
issue's acceptance criteria describe: launching uvicorn with the factory
pattern and a missing secret must exit non-zero, print a message naming the
missing variable, and never serve a request.
"""

from __future__ import annotations

import os
import subprocess
import sys

from conftest import ENV_VAR_NAMES, VALID_ENV


def test_uvicorn_exits_fast_when_session_secret_missing() -> None:
    env = {**VALID_ENV}
    del env["SESSION_SECRET"]

    process_env = _process_env(env)

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "planora_api.main:create_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            "0",
        ],
        env=process_env,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,  # a non-zero exit is the expected, asserted outcome
    )

    assert result.returncode != 0
    assert "SESSION_SECRET" in result.stderr
    # A process that exited before serving never printed uvicorn's
    # "Application startup complete" / "Uvicorn running" banner.
    assert "Uvicorn running" not in result.stdout
    assert "Uvicorn running" not in result.stderr


def _process_env(overrides: dict[str, str]) -> dict[str, str]:
    env = os.environ.copy()
    for name in ENV_VAR_NAMES:
        env.pop(name, None)
    env.update(overrides)
    return env
