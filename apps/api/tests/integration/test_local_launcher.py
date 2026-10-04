"""Run the actual launcher in an isolated layout with supervised command doubles.

Only the launcher is copied: no checkout, dependencies or user configuration.
The setup double runs real migrations and the unchanged admin prompts against
a disposable database. Service doubles record test-only effective configuration.
"""

from __future__ import annotations

import asyncio
import json
import os
import select
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
from conftest import ENV_VAR_NAMES, make_client

from planora_api.config import load_settings
from planora_api.main import create_app

REPO = Path(__file__).resolve().parents[4]
SITE_PASSWORD = "local-site-password"  # >= 12 characters
SIGNING_SECRET = "local-signing-secret-0123456789abcdef"  # >= 32 characters

DOUBLE = '''#!PYTHON
import json, os, sys, time
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
if name == "uv" and args[:3] == ["run", "python", "-c"]:
    os.execv(sys.executable, [sys.executable, *args[2:]])
record = {"name": name, "args": args,
          "secret": os.environ.get("SESSION_SECRET"),
          "password": os.environ.get("APP_PASSWORD"),
          "origin": os.environ.get("APP_ORIGIN"),
          "key": os.environ.get("LLM_API_KEY"),
          "mode": os.environ.get("VITE_API_MODE"),
          "proxy": os.environ.get("PLANORA_API_PROXY_TARGET")}
fd = os.open(os.environ["RECORDS"], os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
os.write(fd, (json.dumps(record) + "\\n").encode())
os.close(fd)
if name == "curl":
    time.sleep(0.1)
    if os.environ.get("DELAY_WEB") and args[-1].startswith("http://localhost:"):
        attempts = Path(os.environ["RECORDS"]).with_suffix(".attempts")
        count = int(attempts.read_text()) if attempts.exists() else 0
        attempts.write_text(str(count + 1))
        if count < 2:
            sys.exit(1)
    sys.exit(0)
if args == ["run", "alembic", "upgrade", "head"]:
    from alembic import command
    from alembic.config import Config
    cfg = Config(os.environ["ALEMBIC_CONFIG"])
    cfg.set_main_option("script_location", os.environ["MIGRATIONS"])
    command.upgrade(cfg, "head")
elif "uvicorn" in args or "dev" in args or "planora_api.jobs.scheduler" in args:
    if "dev" in args and os.environ.get("BUSY_PORT"):
        sys.exit(1)
    while True:
        time.sleep(0.1)
'''


class Launcher:
    def __init__(self, root: Path):
        self.root = root
        # Exercise the unchanged launcher paths on available ports so this
        # harness never interferes with an already-running user stack.
        with socket.socket() as api, socket.socket() as web:
            api.bind(("127.0.0.1", 0))
            web.bind(("127.0.0.1", 0))
            self.api_port = api.getsockname()[1]
            self.web_port = web.getsockname()[1]
        self.origin = f"http://localhost:{self.web_port}"
        (root / "scripts").mkdir()
        (root / "apps/api").mkdir(parents=True)
        (root / "apps/web").mkdir()
        script = (REPO / "scripts/run-local.sh").read_text()
        script = script.replace('API_PORT="8000"', f'API_PORT="{self.api_port}"')
        script = script.replace("http://localhost:5173", self.origin)
        (root / "scripts/run-local.sh").write_text(script)
        self.env_file = root / "apps/api/.env"
        self.records_path = root / "records.jsonl"
        bin_dir = root / "bin"
        bin_dir.mkdir()
        for name in ("uv", "bun", "curl"):
            path = bin_dir / name
            path.write_text(DOUBLE.replace("#!PYTHON", f"#!{sys.executable}"))
            path.chmod(0o700)
        self.env = {k: v for k, v in os.environ.items() if k not in ENV_VAR_NAMES}
        self.env.update(
            PATH=f"{bin_dir}:{os.environ['PATH']}",
            PYTHONPATH=str(REPO / "apps/api/src"),
            RECORDS=str(self.records_path),
            PROMPTS=str(root / "prompts.json"),
            ALEMBIC_CONFIG=str(REPO / "apps/api/alembic.ini"),
            MIGRATIONS=str(REPO / "apps/api/alembic"),
        )

    def configure(self, extra: str = "") -> str:
        content = (
            f"DATABASE_URL=sqlite:///{self.root / 'local.db'}\nLLM_API_KEY=placeholder\n"
            f"APP_PASSWORD={SITE_PASSWORD}\nSESSION_SECRET={SIGNING_SECRET}\n{extra}"
        )
        self.env_file.write_text(content)
        return content

    def records(self) -> list[dict]:
        if not self.records_path.exists():
            return []
        return [json.loads(line) for line in self.records_path.read_text().splitlines()]

    def run(self, *args: str, ready: bool = False) -> tuple[int, str]:
        process = subprocess.Popen(
            ["bash", str(self.root / "scripts/run-local.sh"), *args],
            cwd=self.root, env=self.env, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True,
        )
        output = ""
        try:
            if ready:
                assert process.stdout is not None
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    readable, _, _ = select.select([process.stdout], [], [], 0.1)
                    if readable:
                        line = process.stdout.readline()
                        output += line
                        if "Ready. Open" in line:
                            process.send_signal(signal.SIGTERM)
                            break
                        if not line and process.poll() is not None:
                            break
                else:
                    pytest.fail("Launcher did not become ready")
            tail, _ = process.communicate(timeout=15)
            return process.returncode, output + tail
        finally:
            if process.poll() is None:
                process.terminate()
                process.communicate(timeout=15)


@pytest.fixture
def launcher(tmp_path: Path) -> Launcher:
    return Launcher(tmp_path)


@pytest.mark.parametrize("blank", [None, "", " \t "])
def test_defaults_are_shared_private_ephemeral_and_env_is_unchanged(
    launcher: Launcher, blank: str | None,
) -> None:
    extra = "" if blank is None else f"APP_ORIGIN={blank}\n"
    original = launcher.configure(extra)
    code, output = launcher.run(ready=True)
    assert code == 0, output
    records = launcher.records()
    configured = [r for r in records if r["name"] in {"uv", "bun"} and r["args"] != ["sync", "--locked"]]
    assert all(r["secret"] == SIGNING_SECRET for r in configured)
    assert all(r["password"] == SITE_PASSWORD for r in configured)
    assert all(r["origin"] == launcher.origin for r in configured)
    assert all(r["key"] == "placeholder" for r in configured)
    # Neither secret is ever echoed by the launcher.
    assert SIGNING_SECRET not in output and SITE_PASSWORD not in output
    assert f"Ready. Open {launcher.origin}" in output
    assert "unlock with the APP_PASSWORD" in output
    web = next(r for r in records if "dev" in r["args"])
    assert web["args"] == ["run", "dev", "--", "--host", "localhost", "--port", str(launcher.web_port), "--strictPort"]
    assert web["mode"] == "http"
    assert web["proxy"] == f"http://127.0.0.1:{launcher.api_port}"
    assert launcher.env_file.read_text() == original
    assert not any("planora_api.admin.reset_password" in r["args"] for r in records)
    code, output = launcher.run(ready=True)
    assert code == 0, output
    assert all(r["secret"] == SIGNING_SECRET for r in launcher.records()[len(records):]
               if r["name"] in {"uv", "bun"} and r["args"] != ["sync", "--locked"])
    assert launcher.env_file.read_text() == original


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1"])
def test_overrides_are_preserved_without_shell_execution(launcher: Launcher, host: str) -> None:
    origin = f"http://{host}:{launcher.web_port}"
    secret = 'literal-$(touch SHOULD_NOT_EXIST)-`echo secret`-padding-padding'
    password = 'pw-$(touch SHOULD_NOT_EXIST)-`echo pw`'
    launcher.env_file.write_text(
        f"DATABASE_URL=sqlite:///{launcher.root / 'local.db'}\nLLM_API_KEY=placeholder\n"
        f"APP_PASSWORD={password}\nSESSION_SECRET={secret}\nAPP_ORIGIN={origin}\n"
    )
    original = launcher.env_file.read_text()
    code, output = launcher.run(ready=True)
    assert code == 0, output
    assert all(r["secret"] == secret and r["password"] == password and r["origin"] == origin
               for r in launcher.records() if r["args"] != ["sync", "--locked"])
    assert secret not in output and password not in output
    assert not (launcher.root / "SHOULD_NOT_EXIST").exists()
    assert launcher.env_file.read_text() == original


@pytest.mark.parametrize("key", [None, "", " \t "])
def test_blank_llm_key_fails_before_any_command(launcher: Launcher, key: str | None) -> None:
    launcher.env_file.write_text("" if key is None else f"LLM_API_KEY={key}\n")
    code, output = launcher.run()
    assert code != 0
    assert "LLM_API_KEY" in output
    assert launcher.records() == []


@pytest.mark.parametrize("name", ["APP_PASSWORD", "SESSION_SECRET"])
@pytest.mark.parametrize("value", [None, "", " \t ", "short"])
def test_blank_or_short_gate_secret_fails_naming_it_before_any_command(
    launcher: Launcher, name: str, value: str | None,
) -> None:
    lines = {"LLM_API_KEY": "placeholder", "APP_PASSWORD": SITE_PASSWORD, "SESSION_SECRET": SIGNING_SECRET}
    if value is None:
        del lines[name]
    else:
        lines[name] = value
    launcher.env_file.write_text("".join(f"{k}={v}\n" for k, v in lines.items()))
    code, output = launcher.run()
    assert code != 0
    assert name in output
    minimum = "12" if name == "APP_PASSWORD" else "32"
    expected = f"at least {minimum} characters" if value == "short" else "blank"
    assert expected in output
    assert "short" not in output  # the supplied value is never echoed
    assert launcher.records() == []


@pytest.mark.parametrize("origin", [
    "https://localhost:5173", "http://example.com:5173", "http://localhost:5173/",
    "http://localhost:0", "http://localhost:65536", "http://localhost:abc",
    "http://localhost:5173?private-sentinel",
])
def test_invalid_origin_fails_before_any_command(launcher: Launcher, origin: str) -> None:
    launcher.configure(f"APP_ORIGIN={origin}\n")
    code, output = launcher.run()
    assert code != 0
    assert "APP_ORIGIN" in output
    assert "private-sentinel" not in output
    assert launcher.records() == []


def test_missing_env_gives_llm_only_setup_instructions(launcher: Launcher) -> None:
    code, output = launcher.run()
    assert code != 0
    assert "Copy apps/api/.env.example" in output
    for name in ("LLM_API_KEY", "APP_PASSWORD", "SESSION_SECRET"):
        assert name in output
    assert launcher.records() == []


def test_busy_web_port_stops_other_services_and_uses_strict_port(launcher: Launcher) -> None:
    launcher.configure()
    launcher.env["BUSY_PORT"] = "1"
    code, output = launcher.run()
    assert code != 0
    assert "web dev server" in output
    web = next(r for r in launcher.records() if "dev" in r["args"])
    assert "--strictPort" in web["args"]


@pytest.mark.parametrize("service", ["API", "web"])
def test_occupied_port_is_rejected_without_stopping_existing_listener(
    launcher: Launcher, service: str,
) -> None:
    launcher.configure()
    port = launcher.api_port if service == "API" else launcher.web_port
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", port))
        listener.listen()
        code, output = launcher.run(ready=True)
        assert code != 0, output
        assert f"{service} port {port} is unavailable" in output
        assert "Ready. Open" not in output
        assert not any("uvicorn" in r["args"] or "dev" in r["args"]
                       or "planora_api.jobs.scheduler" in r["args"]
                       for r in launcher.records())
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            pass


def test_ready_waits_for_web_and_proxied_api(launcher: Launcher) -> None:
    launcher.configure()
    launcher.env["DELAY_WEB"] = "1"
    code, output = launcher.run(ready=True)
    assert code == 0, output
    urls = [r["args"][-1] for r in launcher.records() if r["name"] == "curl"]
    assert urls.count(f"{launcher.origin}/") >= 3
    assert f"{launcher.origin}/api/v1/health" in urls


@pytest.mark.parametrize("host", [None, "127.0.0.1"])
def test_launcher_migrates_and_both_profiles_work_without_setup(
    launcher: Launcher, monkeypatch: pytest.MonkeyPatch, host: str | None,
) -> None:
    origin = None if host is None else f"http://{host}:{launcher.web_port}"
    template = (REPO / "apps/api/.env.example").read_text()
    content = template.replace("LLM_API_KEY=\n", "LLM_API_KEY=placeholder\n")
    content = content.replace("APP_PASSWORD=\n", f"APP_PASSWORD={SITE_PASSWORD}\n")
    content = content.replace("SESSION_SECRET=\n", f"SESSION_SECRET={SIGNING_SECRET}\n")
    if origin is not None:
        content = content.replace("APP_ORIGIN=\n", f"APP_ORIGIN={origin}\n")
    launcher.env_file.write_text(content)
    code, output = launcher.run(ready=True)
    assert code == 0, output
    records = launcher.records()
    assert any(r["args"] == ["run", "alembic", "upgrade", "head"] for r in records)
    assert not any("reset_password" in str(r["args"]) for r in records)
    assert not (launcher.root / "prompts.json").exists()
    for name in ENV_VAR_NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(launcher.root / "apps/api")
    config = next(r for r in records if "uvicorn" in r["args"])
    monkeypatch.setenv("APP_ORIGIN", config["origin"])
    monkeypatch.setenv("LLM_API_KEY", "placeholder")
    monkeypatch.setenv("APP_PASSWORD", config["password"])
    monkeypatch.setenv("SESSION_SECRET", config["secret"])
    app = create_app()
    async def scenario() -> None:
        async with make_client(app, origin=config["origin"], base_url=config["origin"],
                               authenticated=False) as client:
            # Locked until the launcher's password is entered, then both profiles work.
            assert (await client.get("/api/v1/tasks", headers={"X-Planora-Profile": "hamster_knight"})).status_code == 401
            assert (await client.post("/api/v1/auth/login", json={"password": SITE_PASSWORD})).status_code == 200
            for profile in ("hamster_knight", "ech_princess"):
                client.headers["X-Planora-Profile"] = profile
                assert (await client.get("/api/v1/tasks")).status_code == 200
            wrong_host = "127.0.0.1" if origin is None else "localhost"
            response = await client.post("/api/v1/tasks", json={"title": "x", "content": "y"},
                                         headers={"Origin": f"http://{wrong_host}:{launcher.web_port}"})
            assert response.status_code == 403
    try:
        asyncio.run(scenario())
        assert load_settings().app_origin == config["origin"]
    finally:
        app.state.session_factory.kw["bind"].dispose()


def test_unknown_mode_fails_before_commands(launcher: Launcher) -> None:
    launcher.configure()
    code, output = launcher.run("--unknown")
    assert code != 0
    assert "Usage" in output
    assert launcher.records() == []


def test_retired_setup_mode_is_rejected(launcher: Launcher) -> None:
    launcher.configure()
    code, output = launcher.run("--setup-account")
    assert code != 0
    assert "Usage" in output
    assert launcher.records() == []
