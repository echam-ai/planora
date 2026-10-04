"""Compose supplies and requires the site-password secrets (issue #124, AC25)."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
COMPOSE = ROOT / "deploy/compose.yml"
SECRETS = ("APP_PASSWORD", "SESSION_SECRET")
_ENV = {
    "DATABASE_URL": "postgresql+psycopg://u:p@db:5432/d",
    "LLM_API_KEY": "k",
    "LLM_BASE_URL": "https://llm.example/v1",
    "LLM_MODEL": "m",
    "APP_ORIGIN": "https://planora.example",
    "DEFAULT_TIMEZONE": "UTC",
    "CADDY_BIND_ADDRESS": "127.0.0.1",
    "CADDY_HTTP_PORT": "18080",
    "CADDY_IP": "172.30.43.2",
    "PROXY_SUBNET": "172.30.43.0/24",
    "PROXY_DYNAMIC_RANGE": "172.30.43.128/25",
    "POSTGRES_DB": "d",
    "POSTGRES_USER": "u",
    "POSTGRES_PASSWORD": "p",
    "APP_PASSWORD": "compose-test-site-password",
    "SESSION_SECRET": "compose-test-session-secret-0123456789",
}


def test_api_environment_anchor_requires_both_secrets():
    text = COMPOSE.read_text()
    anchor = text.split("services:", 1)[0]
    for name in SECRETS:
        assert f"{name}: ${{{name}:?" in anchor
    # api and scheduler both use the anchor, so both refuse to start without them.
    assert text.count("environment: *api-environment") == 2


def test_env_example_lists_both_secrets():
    text = (ROOT / "deploy/.env.example").read_text()
    for name in SECRETS:
        assert f"\n{name}=\n" in text


def _config(env: dict[str, str], tmp_path: Path) -> subprocess.CompletedProcess[str]:
    empty = tmp_path / "empty.env"
    empty.write_text("")
    return subprocess.run(
        ["docker", "compose", "--env-file", str(empty), "-f", str(COMPOSE), "config", "--quiet"],
        cwd=ROOT, env={"PATH": os.environ["PATH"], **env}, capture_output=True, text=True, check=False,
    )


@pytest.mark.skipif(shutil.which("docker") is None, reason="docker CLI not installed")
def test_compose_config_names_a_missing_secret(tmp_path):
    probe = subprocess.run(["docker", "compose", "version"], capture_output=True, check=False)
    if probe.returncode != 0:
        pytest.skip("docker compose plugin unavailable")
    assert _config(_ENV, tmp_path).returncode == 0
    for name in SECRETS:
        for value in (None, ""):
            env = {k: v for k, v in _ENV.items() if k != name}
            if value is not None:
                env[name] = value
            result = _config(env, tmp_path)
            assert result.returncode != 0
            assert name in result.stderr
            assert _ENV[name] not in result.stderr
