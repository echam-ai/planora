# Public HTTPS deployment

Use this runbook after the [six-service setup](compose-stack.md),
[PostgreSQL verification](database-verification.md), and
[backup/restore preparation](backup-restore.md). Commands run from the repository
root over authenticated SSH to the VPS, in the operator's deployment checkout.
Keep runtime environment files private, outside git, with mode 0600. Never put
real credentials in issue comments or print expanded Compose configuration.

Plain-HTTP IP access is for initial setup only and is not approved for normal use
because it exposes task and chat data in transit. The base `compose.yml` and
`Caddyfile` deliberately remain setup HTTP. Approved public access uses both
`compose.yml` and `compose.production.yml` with a real public domain. An unset
`PLANORA_DOMAIN` makes the production overlay fail configuration; it cannot
silently fall back to setup HTTP.

## Operator inputs and network

Obtain the production FQDN, public VPS IPv4, DNS control/provider and record mode,
SSH access, deployment path, and firewall/NAT control. Set a direct DNS A record
to the VPS. Publish an AAAA record only if the matching IPv6 address reaches this
same Caddy service on TCP 80/443; remove stale AAAA records. This configuration
assumes Caddy is the first and only public proxy. Use DNS-only/direct mode, not a
provider's HTTP proxy, unless the forwarding trust chain is separately reviewed.
For IPv6, configure a reachable host bind/forwarding path and verify both address
families externally; the example IPv4 bind below alone does not prove IPv6 access.

Allow inbound TCP 80 and 443 through the cloud firewall, VPS firewall, and any
NAT forwarding. Caddy needs outbound DNS and HTTPS access to public certificate
authorities. Keep SSH restricted appropriately. Do not publish web/API/DB or
worker ports. No wildcard domain, scheme, port, path, IP address, or local domain
belongs in production `PLANORA_DOMAIN`; use one public FQDN, for example
`tasks.example.com`. Caddy automatically obtains and renews public ACME
certificates and redirects HTTP for that hostname, preserving path/query.
See [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).

Copy `deploy/.env.example` into the private runtime env file used in the commands
below (example `/srv/planora/runtime.env`). Fill all secrets and existing
database/subnet settings from the setup guide. For production set:

```dotenv
CADDY_BIND_ADDRESS=0.0.0.0
CADDY_HTTP_PORT=80
PLANORA_DOMAIN=tasks.example.com
APP_ORIGIN=https://tasks.example.com
```

The production overlay replaces setup ports with TCP 80/443 and derives both API
and scheduler `APP_ORIGIN` directly from `PLANORA_DOMAIN`, overriding any stale
setup origin. Retain matching `APP_ORIGIN` in the env file for clarity. Compose
2.24.4 or newer is required for `!override`. Keep the existing fixed `CADDY_IP`
and excluding dynamic pool: uvicorn trusts exactly that peer, Caddy replaces
client forwarding headers, and browser `Origin` reaches the API unchanged.
`/api/v1/*` keeps its prefix; all other paths go to web.

## Validate, start, and apply configuration

Use the same project name, env file, and both Compose files for every production
command. Reuse the existing project's name when activating HTTPS on an existing
stack, so its database/backups remain attached. Build the images from the chosen
checkout. For a fresh installation, migrate and create the account using the
setup guide before starting the scheduler; for an existing installation, apply
any outstanding migrations without replacing account data.

```sh
rtk docker compose --env-file /srv/planora/runtime.env -p planora -f deploy/compose.yml -f deploy/compose.production.yml config --quiet
rtk docker compose --env-file /srv/planora/runtime.env -p planora -f deploy/compose.yml -f deploy/compose.production.yml build
rtk docker compose --env-file /srv/planora/runtime.env -p planora -f deploy/compose.yml -f deploy/compose.production.yml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
rtk docker compose --env-file /srv/planora/runtime.env -p planora -f deploy/compose.yml -f deploy/compose.production.yml up -d --wait caddy api web db
rtk docker compose --env-file /srv/planora/runtime.env -p planora -f deploy/compose.yml -f deploy/compose.production.yml up -d scheduler backup
rtk docker compose --env-file /srv/planora/runtime.env -p planora -f deploy/compose.yml -f deploy/compose.production.yml ps
rtk docker compose --env-file /srv/planora/runtime.env -p planora -f deploy/compose.yml -f deploy/compose.production.yml logs --tail 100 caddy
```

Validation may begin certificate management once Caddy starts; do not repeatedly
test invented public names against public ACME. Diagnose DNS, reachability,
system clock, and issuance errors before retrying. Ports 80/443 must remain open
for redirects and automatic renewal challenges. No manual certificate copy or
renewal cron is needed.

Wait for the healthchecked services first, then start the workers. The scheduler
intentionally disables the API image's healthcheck; some Compose versions reject
an all-service `--wait` when a worker has a disabled healthcheck.

Caddy's admin API is disabled. Apply/reload a changed domain/config by validated
proxy recreation rather than `caddy reload`; changing environment requires
recreation too:

```sh
rtk docker compose --env-file /srv/planora/runtime.env -p planora -f deploy/compose.yml -f deploy/compose.production.yml up -d --no-deps --force-recreate caddy
```

If the domain changes, also recreate API/scheduler to apply the matching origin.
`caddy-data` stores certificate keys, CA accounts and managed certificates;
`caddy-config` preserves Caddy configuration state. Both named volumes survive
recreation and ordinary `down`/`up`. Never run `down --volumes`, remove these
volumes, or change project identity for normal operations. Certificate private
keys are sensitive. Inspect filenames/metadata without publishing key contents.

## External production checks — HUMAN

Run these from a machine/network **outside the VPS**, after production DNS
resolves. Replace the example domain with the actual hostname. VPS-only curl
does not satisfy these checks. Record date/time, hostname and external
client/network, HTTP status and Location for the redirect:

```sh
rtk curl --silent --show-error --dump-header - --output /dev/null 'http://tasks.example.com/?check=redirect'
rtk curl --fail --show-error 'https://tasks.example.com/health'
rtk curl --fail --show-error 'https://tasks.example.com/api/v1/health'
rtk openssl s_client -connect tasks.example.com:443 -servername tasks.example.com -verify_hostname tasks.example.com -verify_return_error -showcerts </dev/null
```

Expect HTTP 308 and `Location: https://tasks.example.com/?check=redirect`;
both health responses must be `{"status":"ok"}` with normal trust validation.
Inspect the leaf certificate in a normally validating browser or save the
public leaf certificate to a scratch file and run
`rtk openssl x509 -in leaf.pem -noout -issuer -subject -dates -ext subjectAltName`.
Record issuer, exact hostname/SAN match, current validity dates, and the external
client/network. Never use `curl -k`, a browser certificate bypass, or a fixture
CA for these production checks. Choose Hamster Knight or Ech Princess on the
landing page and create a non-AI task over the HTTPS origin. Scoped API requests
carry `X-Planora-Profile`; no authentication cookie is used. Missing/foreign Origin must
still return `403 CSRF_ORIGIN_MISMATCH`. Until off-host evidence exists, both
issue #46 HUMAN checks remain unchecked; local success is not a public deployment.

## Isolated automated TLS fixture

Create `.tmp/https46.env` in the issue worktree from `deploy/.env.example`, using
only disposable credentials, `IMAGE_TAG=issue-46-tls`, an unused subnet and
excluding pool, `PLANORA_DOMAIN=planora.localhost`, loopback setup bind, and
`APP_ORIGIN=https://planora.localhost`. No real VPS or DNS is required. Combine
the test overlay last; it uses loopback 18046/18446 and Caddy's automatic local
CA because `.localhost` is local. Production has no test-issuer override.

```sh
rtk docker compose --env-file .tmp/https46.env -p planora46-fixture -f deploy/compose.yml -f deploy/compose.production.yml -f deploy/compose.test-https.yml build
```

From `apps/api`, run the targeted regression under the shared host lock:

```sh
(
  rtk flock --shared 9 && \
  PLANORA_TLS_SMOKE_PROJECT=planora46-fixture \
  PLANORA_TLS_SMOKE_ENV="$PWD/../../.tmp/https46.env" \
  rtk uv run pytest tests/unit/test_deployment_https.py tests/integration/test_deployment_https.py -v -s
) 9>/home/hamster/code/planora/.tmp/host-suites.lock
```

The test starts/migrates/seeds only that disposable project, validates rendered
production policy, checks actual port bindings, exports the fixture root CA into
pytest scratch, and explicitly trusts it with `curl --cacert` (never `-k`).
`--connect-to` directs hostname/SNI traffic to loopback ports without editing DNS.
It checks 308 path/query, health and API prefix, profile context, profile-scoped
task creation, unchanged HTTPS Origin handling, rejection of missing/wrong Origin,
and identical root/leaf certificate state plus existing task access after proxy
recreation. Cleanup deletes only this explicitly disposable project's volumes.
Optional `PLANORA_TLS_HTTP_PORT`/`PLANORA_TLS_HTTPS_PORT` environment variables
change the fixture ports for both Compose and curl. Fixture evidence cannot
satisfy the external public-certificate checks.
