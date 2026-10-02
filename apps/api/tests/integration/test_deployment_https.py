"""Opt-in isolated real Caddy TLS regression; see docs/ops/deploy.md.

Uses a disposable six-service project and trusts only its exported fixture CA.
Never accepts an insecure TLS client or contacts a production deployment.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
DOMAIN = "planora.localhost"
ORIGIN = f"https://{DOMAIN}"


def test_caddy_https_redirect_auth_origin_and_persistent_certificates(tmp_path):
    project = os.environ.get("PLANORA_TLS_SMOKE_PROJECT")
    if not project:
        pytest.skip("opt-in: PLANORA_TLS_SMOKE_PROJECT=planora46-...; see deploy runbook")
    assert project.startswith("planora46-"), "Only explicitly disposable #46 projects"
    env_file = Path(os.environ["PLANORA_TLS_SMOKE_ENV"]).resolve()
    assert env_file.is_relative_to(ROOT / ".tmp"), "Fixture env belongs in worktree .tmp"
    compose = ["docker", "compose", "--env-file", str(env_file), "-p", project]
    for name in ("compose.yml", "compose.production.yml", "compose.test-https.yml"):
        compose += ["-f", str(ROOT / "deploy" / name)]

    def run(*args, check=True, input=None):
        result = subprocess.run(compose + list(args), cwd=ROOT, check=False,
                                capture_output=True, text=True, input=input)
        if check:
            assert result.returncode == 0, result.stderr
        return result

    production = compose[:-2]
    production_env = dict(os.environ, PLANORA_DOMAIN="tasks.example.com")
    production_config = json.loads(subprocess.run(
        production + ["config", "--format", "json"], cwd=ROOT, env=production_env,
        check=True, capture_output=True, text=True).stdout)
    assert {p["target"] for p in production_config["services"]["caddy"]["ports"]} == {80, 443}
    for service in ("api", "scheduler"):
        assert production_config["services"][service]["environment"]["APP_ORIGIN"] == "https://tasks.example.com"
    unset = subprocess.run(production + ["config", "--quiet"], cwd=ROOT,
                           env=dict(os.environ, PLANORA_DOMAIN=""),
                           check=False, capture_output=True, text=True)
    assert unset.returncode != 0 and "PLANORA_DOMAIN" in unset.stderr

    rendered = json.loads(run("config", "--format", "json").stdout)
    for service, config in rendered["services"].items():
        assert bool(config.get("ports")) == (service == "caddy")
    caddy_config = rendered["services"]["caddy"]
    assert {p["target"] for p in caddy_config["ports"]} == {80, 443}
    assert all(p["host_ip"] == "127.0.0.1" for p in caddy_config["ports"])
    assert rendered["services"]["api"]["environment"]["APP_ORIGIN"] == ORIGIN
    assert rendered["services"]["scheduler"]["environment"]["APP_ORIGIN"] == ORIGIN
    peer = rendered["services"]["caddy"]["networks"]["proxy"]["ipv4_address"]
    assert rendered["services"]["api"]["command"][-1] == peer
    assert {v["target"] for v in caddy_config["volumes"]} >= {"/data", "/config"}

    # Same production configuration with a public domain has no internal issuer.
    adapted = json.loads(run("run", "--rm", "--no-deps", "-e",
                             "PLANORA_DOMAIN=planora.example.com", "caddy", "caddy",
                             "adapt", "--config", "/etc/caddy/Caddyfile",
                             "--adapter", "caddyfile").stdout)
    assert "planora.example.com" in json.dumps(adapted)
    assert '"internal"' not in json.dumps(adapted)
    assert "certificates" not in adapted.get("apps", {}).get("tls", {})
    assert "auto_https" not in adapted["apps"]["http"]["servers"]["srv0"]
    run("run", "--rm", "--no-deps", "caddy", "caddy", "validate",
        "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")

    http_port = os.environ.get("PLANORA_TLS_HTTP_PORT", "18046")
    https_port = os.environ.get("PLANORA_TLS_HTTPS_PORT", "18446")
    ca = tmp_path / "fixture-root.crt"
    cookies = tmp_path / "cookies.txt"

    def request(path, *, secure=True, method="GET", origin=None, body=None):
        headers, content = tmp_path / "headers", tmp_path / "body"
        port = "443" if secure else "80"
        target = https_port if secure else http_port
        args = ["curl", "--silent", "--show-error", "--noproxy", "*",
                "--retry", "15", "--retry-all-errors", "--retry-delay", "1",
                "--connect-to", f"{DOMAIN}:{port}:127.0.0.1:{target}",
                "--dump-header", str(headers), "--output", str(content),
                "--write-out", "%{http_code}", "--request", method,
                "--cookie", str(cookies), "--cookie-jar", str(cookies)]
        if secure:
            args += ["--cacert", str(ca)]
        if origin is not None:
            args += ["--header", f"Origin: {origin}"]
        if body is not None:
            args += ["--header", "Content-Type: application/json", "--data", json.dumps(body)]
        args += [(ORIGIN if secure else f"http://{DOMAIN}") + path]
        response = subprocess.run(args, check=True, capture_output=True, text=True)
        return int(response.stdout), headers.read_text(), content.read_text()

    try:
        run("up", "-d", "--wait", "db")
        run("run", "--rm", "--no-deps", "api", "alembic", "upgrade", "head")
        # Only the unique fixture database: never administrative production writes.
        seed = """from datetime import datetime, UTC
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from planora_api.config import Settings
from planora_api.db.models import AppUser
from planora_api.security.password import hash_password
with Session(create_engine(Settings().database_url)) as session:
    now = datetime.now(UTC)
    session.merge(AppUser(id=1, username='tls-fixture',
        password_hash=hash_password('Disposable46!Password'), created_at=now, updated_at=now))
    session.commit()
"""
        run("run", "--rm", "--no-deps", "-T", "api", "python", "-c", seed)
        run("up", "-d", "--wait", "--wait-timeout", "120", "caddy", "api", "web", "db")
        # Scheduler intentionally disables the API image healthcheck. Some
        # Compose versions reject --wait for such a worker, so start separately.
        run("up", "-d", "scheduler", "backup")
        for service in rendered["services"]:
            container = run("ps", "-q", service).stdout.strip()
            inspected = json.loads(subprocess.run(
                ["docker", "inspect", container], check=True, capture_output=True, text=True).stdout)[0]
            assert bool(inspected["HostConfig"]["PortBindings"]) == (service == "caddy")
        run("cp", "caddy:/data/caddy/pki/authorities/local/root.crt", str(ca))
        root_before = ca.read_bytes()
        cert_path = f"/data/caddy/certificates/local/{DOMAIN}/{DOMAIN}.crt"
        cert_before = run("exec", "-T", "caddy", "cat", cert_path).stdout
        status, headers, _ = request("/login?check=redirect", secure=False)
        assert status == 308
        assert f"Location: {ORIGIN}/login?check=redirect".lower() in headers.lower()
        for path in ("/health", "/api/v1/health"):
            status, _, body = request(path)
            assert status == 200 and json.loads(body) == {"status": "ok"}
        assert request("/login")[0] == 200
        status, _, body = request("/api/v1/does-not-exist")
        assert status == 404 and json.loads(body)["code"] == "NOT_FOUND"
        status, headers, _ = request("/api/v1/auth/login", method="POST", origin=ORIGIN,
                                     body={"username": "tls-fixture", "password": "Disposable46!Password"})
        assert status == 200
        cookie = next(line.lower() for line in headers.splitlines() if line.lower().startswith("set-cookie:"))
        assert all(attribute in cookie for attribute in ("secure", "httponly", "samesite=lax"))
        status, _, body = request("/api/v1/tasks", method="POST", origin=ORIGIN,
                                 body={"title": "HTTPS transport", "content": "Fixture write"})
        assert status == 201
        task_id = json.loads(body)["id"]
        for wrong in (None, "http://planora.localhost", "https://foreign.example"):
            status, _, body = request("/api/v1/tasks", method="POST", origin=wrong,
                                     body={"title": "Rejected", "content": "Wrong origin"})
            assert status == 403 and json.loads(body)["code"] == "CSRF_ORIGIN_MISMATCH"
        run("up", "-d", "--no-deps", "--force-recreate", "caddy")
        assert request("/api/v1/health")[0] == 200
        assert run("exec", "-T", "caddy", "cat", cert_path).stdout == cert_before
        run("cp", "caddy:/data/caddy/pki/authorities/local/root.crt", str(ca))
        assert ca.read_bytes() == root_before
        assert request(f"/api/v1/tasks/{task_id}")[0] == 200
        print("308 path/query redirect; CA-validated HTTPS health/prefix; Secure HttpOnly SameSite cookie")
        print("HTTPS Origin write accepted; missing/wrong Origin rejected; all service ports private")
        print("Caddy leaf/root state and authenticated task survive proxy recreation")
    finally:
        # This named project's disposable state only. Production commands never use -v.
        run("down", "--volumes", "--remove-orphans")
