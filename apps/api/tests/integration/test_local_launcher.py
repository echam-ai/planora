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
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest
from conftest import ENV_VAR_NAMES, make_client

from planora_api.config import load_settings
from planora_api.main import create_app

REPO = Path(__file__).resolve().parents[4]
PASSWORD = "local-test-password"

DOUBLE = '''#!PYTHON
import json, os, sys, time
from pathlib import Path
name = Path(sys.argv[0]).name
args = sys.argv[1:]
if name == "uv" and args[:3] == ["run", "python", "-c"]:
    os.execv(sys.executable, [sys.executable, *args[2:]])
record = {"name": name, "args": args,
          "secret": os.environ.get("SESSION_SECRET"),
          "origin": os.environ.get("APP_ORIGIN"),
          "key": os.environ.get("LLM_API_KEY"),
          "mode": os.environ.get("VITE_API_MODE"),
          "proxy": os.environ.get("PLANORA_API_PROXY_TARGET")}
fd = os.open(os.environ["RECORDS"], os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
os.write(fd, (json.dumps(record) + "\\n").encode())
os.close(fd)
if name == "curl":
    time.sleep(0.1)
    sys.exit(0)
if args == ["run", "alembic", "upgrade", "head"]:
    from alembic import command
    from alembic.config import Config
    cfg = Config(os.environ["ALEMBIC_CONFIG"])
    cfg.set_main_option("script_location", os.environ["MIGRATIONS"])
    command.upgrade(cfg, "head")
elif args == ["run", "python", "-m", "planora_api.admin.reset_password"]:
    from planora_api.admin.reset_password import main
    prompts = []
    def read(prompt):
        prompts.append(prompt)
        return "local-user"
    def password(prompt):
        prompts.append(prompt)
        return "local-test-password"
    result = main([], read_line=read, prompt=password, stdin_is_tty=lambda: True)
    Path(os.environ["PROMPTS"]).write_text(json.dumps(prompts))
    sys.exit(result)
elif "uvicorn" in args or "dev" in args or "planora_api.jobs.scheduler" in args:
    if "dev" in args and os.environ.get("BUSY_PORT"):
        sys.exit(1)
    while True:
        time.sleep(0.1)
'''


class Launcher:
    def __init__(self, root: Path):
        self.root = root
        (root / "scripts").mkdir()
        (root / "apps/api").mkdir(parents=True)
        (root / "apps/web").mkdir()
        shutil.copyfile(REPO / "scripts/run-local.sh", root / "scripts/run-local.sh")
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
        content = f"DATABASE_URL=sqlite:///{self.root / 'local.db'}\nLLM_API_KEY=placeholder\n{extra}"
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
    extra = "" if blank is None else f"SESSION_SECRET={blank}\nAPP_ORIGIN={blank}\n"
    original = launcher.configure(extra)
    code, output = launcher.run(ready=True)
    assert code == 0, output
    records = launcher.records()
    configured = [r for r in records if r["name"] in {"uv", "bun"} and r["args"] != ["sync", "--locked"]]
    secret = configured[0]["secret"]
    assert len(bytes.fromhex(secret)) >= 32
    assert all(r["secret"] == secret for r in configured)
    assert all(r["origin"] == "http://localhost:5173" for r in configured)
    assert all(r["key"] == "placeholder" for r in configured)
    assert secret not in output
    assert "Ready. Open http://localhost:5173" in output
    web = next(r for r in records if "dev" in r["args"])
    assert web["args"] == ["run", "dev", "--", "--host", "localhost", "--port", "5173", "--strictPort"]
    assert web["mode"] == "http"
    assert web["proxy"] == "http://127.0.0.1:8000"
    assert launcher.env_file.read_text() == original
    assert not any("planora_api.admin.reset_password" in r["args"] for r in records)
    code, output = launcher.run(ready=True)
    assert code == 0, output
    new_secret = launcher.records()[len(records) + 1]["secret"]
    assert new_secret != secret
    assert new_secret not in output
    assert launcher.env_file.read_text() == original


@pytest.mark.parametrize("origin", ["http://localhost:5199", "http://127.0.0.1:5199"])
def test_overrides_are_preserved_without_shell_execution(launcher: Launcher, origin: str) -> None:
    secret = 'literal-$(touch SHOULD_NOT_EXIST)-`echo secret`'
    original = launcher.configure(f"SESSION_SECRET={secret}\nAPP_ORIGIN={origin}\n")
    code, output = launcher.run(ready=True)
    assert code == 0, output
    assert all(r["secret"] == secret and r["origin"] == origin
               for r in launcher.records() if r["args"] != ["sync", "--locked"])
    assert secret not in output
    assert not (launcher.root / "SHOULD_NOT_EXIST").exists()
    assert launcher.env_file.read_text() == original


@pytest.mark.parametrize("key", [None, "", " \t "])
def test_blank_llm_key_fails_before_any_command(launcher: Launcher, key: str | None) -> None:
    launcher.env_file.write_text("" if key is None else f"LLM_API_KEY={key}\n")
    code, output = launcher.run()
    assert code != 0
    assert "LLM_API_KEY" in output
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
    assert "LLM_API_KEY" in output and "Copy apps/api/.env.example" in output
    assert "fill in SESSION_SECRET" not in output
    assert launcher.records() == []


def test_busy_web_port_stops_other_services_and_uses_strict_port(launcher: Launcher) -> None:
    launcher.configure()
    launcher.env["BUSY_PORT"] = "1"
    code, output = launcher.run()
    assert code != 0
    assert "web dev server" in output
    web = next(r for r in launcher.records() if "dev" in r["args"])
    assert "--strictPort" in web["args"]


@pytest.mark.parametrize("origin", [None, "http://127.0.0.1:5199"])
def test_setup_migrates_creates_account_then_login_and_csrf_work(
    launcher: Launcher, monkeypatch: pytest.MonkeyPatch, origin: str | None,
) -> None:
    # Follow README exactly: copy the template and fill in only the LLM key.
    template = (REPO / "apps/api/.env.example").read_text()
    content = template.replace("LLM_API_KEY=\n", "LLM_API_KEY=placeholder\n")
    if origin is not None:
        content = content.replace("APP_ORIGIN=\n", f"APP_ORIGIN={origin}\n")
    launcher.env_file.write_text(content)
    code, output = launcher.run("--setup-account")
    assert code == 0, output
    records = launcher.records()
    assert [r["args"] for r in records] == [
        ["sync", "--locked"], ["run", "alembic", "upgrade", "head"],
        ["run", "python", "-m", "planora_api.admin.reset_password"],
    ]
    assert json.loads((launcher.root / "prompts.json").read_text()) == [
        "Username: ", "New password: ", "Confirm new password: ",
    ]
    for name in ENV_VAR_NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(launcher.root / "apps/api")
    # Use the ordinary launch's generated configuration, not the setup secret.
    code, output = launcher.run(ready=True)
    assert code == 0, output
    config = next(r for r in launcher.records()[len(records):] if "uvicorn" in r["args"])
    monkeypatch.setenv("SESSION_SECRET", config["secret"])
    monkeypatch.setenv("APP_ORIGIN", config["origin"])
    monkeypatch.setenv("LLM_API_KEY", "placeholder")
    app = create_app()

    async def scenario() -> None:
        async with make_client(app, origin=config["origin"], base_url=config["origin"]) as client:
            login = await client.post("/api/v1/auth/login", json={
                "username": "local-user", "password": PASSWORD,
            })
            assert login.status_code == 200
            assert client.cookies.get("planora_session")
            assert (await client.get("/api/v1/tasks")).status_code == 200
            wrong = "http://127.0.0.1:5173" if origin is None else "http://localhost:5199"
            rejected = await client.post("/api/v1/auth/logout", headers={"Origin": wrong})
            assert rejected.status_code == 403
            token = client.cookies.get("planora_session")
            count = len(launcher.records())
            code, output = launcher.run(ready=True)
            assert code == 0, output
            restarted = next(r for r in launcher.records()[count:] if "uvicorn" in r["args"])
            monkeypatch.setenv("SESSION_SECRET", restarted["secret"])
            restarted_app = create_app()
            try:
                async with make_client(restarted_app, origin=config["origin"],
                                       base_url=config["origin"]) as restarted_client:
                    restarted_client.cookies.set("planora_session", token)
                    assert (await restarted_client.get("/api/v1/tasks")).status_code == 401
            finally:
                restarted_app.state.session_factory.kw["bind"].dispose()

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
