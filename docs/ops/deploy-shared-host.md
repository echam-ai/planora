# Shared-host HTTPS deployment

Use this mode when the VPS already runs a reverse proxy that owns public TCP 80/443 for other apps. For a VPS dedicated to Planora, use [deploy.md](deploy.md) instead, where Planora's own Caddy obtains the certificate.

```text
browser ──HTTPS──► host Caddy (80/443, TLS, other apps too)
                     └─ planora.example.com ──HTTP──► 127.0.0.1:3002 ─► Planora caddy ─┬─ /api/v1/* ─► api:8000
                                                                                        └─ /*        ─► web:3000
```

## Differences from the production overlay

- Combine `compose.yml` with [`compose.behind-proxy.yml`](../../deploy/compose.behind-proxy.yml). Do not use `compose.production.yml`.
- In the runtime env file:
  - `CADDY_BIND_ADDRESS=127.0.0.1`
  - `CADDY_HTTP_PORT` set to a free loopback port (e.g. `3002`)
  - `PLANORA_DOMAIN=` left empty
  - `APP_ORIGIN=https://planora.example.com`, exactly the address the browser shows
- `APP_ORIGIN` is https, so the access cookie is still `Secure` and the CSRF Origin check still matches the browser.
- Planora's Caddy trusts `X-Forwarded-For` only from private-range peers, and the only such peer is the host proxy behind the loopback-bound port. It forwards `{client_ip}`, so the 5-per-IP unlock limit applies to the real browser address. Without this, every visitor would share the Docker bridge address and one bad actor could lock everyone out.
- The host proxy manages TLS certificates and renews them.

## Host proxy block (host Caddy example)

```caddyfile
planora.example.com {
	encode zstd gzip
	header Strict-Transport-Security "max-age=31536000"
	reverse_proxy 127.0.0.1:3002
}
```

## Commands

Run these from the deployment checkout. `ENV=/srv/planora/runtime.env` sets the env file path (mode 0600, outside git). `C` is shorthand for the full Compose command.

```sh
C="docker compose --env-file $ENV -p planora -f deploy/compose.yml -f deploy/compose.behind-proxy.yml"
$C config --quiet
$C build
$C run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
$C up -d --wait db
$C run --rm --no-deps api alembic upgrade head
$C up -d --wait caddy api web db
$C up -d scheduler backup
curl -fsS http://127.0.0.1:3002/api/v1/health
```

Then add the host proxy block, validate the host proxy config, reload it, and run the external checks in [deploy.md](deploy.md#external-production-checks--human). [`scripts/deploy-proof.sh`](../../scripts/deploy-proof.sh) runs those checks and records the results. [`scripts/ops-diagnose.sh`](../../scripts/ops-diagnose.sh) reports the stack's health (set `PLANORA_COMPOSE_OVERLAY=behind-proxy`).
