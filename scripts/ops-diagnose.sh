#!/usr/bin/env bash
# Read-only operational diagnosis of a running Planora Compose deployment.
# Run on the VPS from the deployment checkout:
#   scripts/ops-diagnose.sh /srv/planora/runtime.env [project]
# Prints a Markdown report to stdout. It never prints env values, cookies,
# request bodies or task/chat content — only service state, health, counts and
# log lines filtered to WARNING/ERROR (which Planora already redacts).
set -uo pipefail

ENV_FILE="${1:?usage: scripts/ops-diagnose.sh <runtime.env> [project]}"
PROJECT="${2:-planora}"
# Compose overlays: PLANORA_COMPOSE_OVERLAY=behind-proxy|production|none, else
# production when PLANORA_DOMAIN is set, otherwise base only.
FILES=(-f deploy/compose.yml)
OVERLAY="${PLANORA_COMPOSE_OVERLAY:-}"
[[ -z "$OVERLAY" ]] && grep -q '^PLANORA_DOMAIN=.' "$ENV_FILE" && OVERLAY=production
[[ "$OVERLAY" == production ]] && FILES+=(-f deploy/compose.production.yml)
[[ "$OVERLAY" == behind-proxy ]] && FILES+=(-f deploy/compose.behind-proxy.yml)
DOCKER="${DOCKER:-docker}"
dc() { $DOCKER compose --env-file "$ENV_FILE" -p "$PROJECT" "${FILES[@]}" "$@"; }
# Public hostname: PLANORA_DOMAIN, or the host of an https APP_ORIGIN.
DOMAIN="$(grep -E '^PLANORA_DOMAIN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
[[ -z "$DOMAIN" ]] && DOMAIN="$(grep -E '^APP_ORIGIN=https://' "$ENV_FILE" | sed -E 's#^APP_ORIGIN=https://##; s#[:/].*$##')"

section() { printf '\n## %s\n\n' "$1"; }
code() { printf '```text\n'; cat; printf '```\n'; }

printf '# Planora operational diagnosis\n\n'
printf -- '- Generated: %s\n- Host: %s\n- Commit: %s\n- Compose project: %s\n- Domain: %s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(hostname)" "$(git -c safe.directory='*' rev-parse --short HEAD 2>/dev/null)" "$PROJECT" "${DOMAIN:-<setup HTTP>}"

section "Services"
dc ps --format 'table {{.Service}}\t{{.State}}\t{{.Health}}\t{{.Status}}' 2>&1 | code

section "Health endpoints (from inside the stack)"
{
  echo "api  /api/v1/health -> $(dc exec -T api python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health',timeout=3).read().decode())" 2>&1)"
  echo "web  /health        -> $(dc exec -T web node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.text()).then(t=>console.log(t)).catch(e=>console.log('ERR',e.message))" 2>&1 || true)"
  echo "db   pg_isready     -> $(dc exec -T db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' 2>&1)"
} | code

if [[ -n "$DOMAIN" ]]; then
  section "Public endpoint and TLS"
  {
    curl -sS -o /dev/null -w "http redirect: %{http_code} -> %{redirect_url}\n" "http://$DOMAIN/?check=redirect"
    curl -sS -w "  (%{http_code}, %{time_total}s)\n" "https://$DOMAIN/api/v1/health"
    echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null \
      | openssl x509 -noout -issuer -subject -enddate
  } 2>&1 | code
fi

section "Database migration state"
dc exec -T api alembic current 2>&1 | tail -3 | code

section "Backups (latest recovery points)"
dc exec -T backup sh -c 'ls -lt /backups 2>/dev/null | head -8' 2>&1 | code

section "Scheduler (archive job) — last runs"
dc logs --no-color --since 3h scheduler 2>&1 | grep -iE 'archiv|error|warn' | tail -10 | code

section "Warnings and errors in the last 24h (counts)"
for svc in caddy api web scheduler db backup; do
  n_err=$(dc logs --no-color --since 24h "$svc" 2>&1 | grep -ciE '"level": ?"(error|critical)"|\berror\b|traceback')
  n_warn=$(dc logs --no-color --since 24h "$svc" 2>&1 | grep -ciE '"level": ?"warning"|\bwarn')
  printf '%-10s errors=%-5s warnings=%s\n' "$svc" "$n_err" "$n_warn"
done | code

section "Most recent API warnings/errors (redacted by the app)"
dc logs --no-color --since 24h api 2>&1 | grep -iE 'warn|error|traceback' | tail -15 | code

section "Host resources"
{ uptime; echo; df -h / /var/lib/docker 2>/dev/null; echo; free -h; echo; $DOCKER system df; } 2>&1 | code
$DOCKER stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>&1 | grep -E "NAME|$PROJECT" | code
