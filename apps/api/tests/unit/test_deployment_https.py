"""Production TLS policy stays separate from setup and test certificates."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def test_production_requires_domain_and_derives_matching_origin():
    compose = (ROOT / "deploy/compose.production.yml").read_text()
    assert "${PLANORA_DOMAIN:?" in compose
    assert compose.count("APP_ORIGIN: https://${PLANORA_DOMAIN:?") == 2
    assert "443:443" in compose and "80:80" in compose
    caddy = (ROOT / "deploy/Caddyfile.production").read_text()
    assert "{$PLANORA_DOMAIN}" in caddy
    assert "auto_https off" not in caddy
    assert "tls internal" not in caddy and "tls /" not in caddy


def test_shared_routes_preserve_origin_prefix_and_narrow_forwarding():
    routes = (ROOT / "deploy/Caddyfile.routes").read_text()
    assert "path /api/v1 /api/v1/*" in routes
    assert "handle_path" not in routes
    assert "header_up Origin" not in routes
    for header in ("X-Forwarded-For {remote_host}", "X-Forwarded-Proto {scheme}",
                   "X-Forwarded-Host {host}", "-Forwarded", "-X-Real-IP"):
        assert f"header_up {header}" in routes
    for name in ("Caddyfile", "Caddyfile.production"):
        assert "import /etc/caddy/Caddyfile.routes" in (ROOT / "deploy" / name).read_text()
    compose = (ROOT / "deploy/compose.yml").read_text()
    assert '"${CADDY_IP:?Set Caddy peer IP}"' in compose
    assert "caddy-data:/data" in compose and "caddy-config:/config" in compose


def test_runbook_keeps_external_checks_and_setup_warning_explicit():
    runbook = (ROOT / "docs/ops/deploy.md").read_text()
    for phrase in ("initial setup only", "not approved for normal use", "credentials",
                   "outside the VPS", "--force-recreate", "--volumes", "AAAA",
                   "login?check=redirect", "certificate", "PLANORA_DOMAIN"):
        assert phrase in runbook
