#!/usr/bin/env bash
# External deployment proof, run from a machine OUTSIDE the VPS (docs/ops/deploy.md
# "External production checks"). Usage: scripts/deploy-proof.sh tasks.example.com
# Writes docs/deployment/proof-<date>.md; prints no secrets.
set -euo pipefail
DOMAIN="${1:?usage: scripts/deploy-proof.sh <domain>}"
ROOT="$(git rev-parse --show-toplevel)"
OUT="$ROOT/docs/deployment/proof-$(date -u +%Y-%m-%d).md"
mkdir -p "$(dirname "$OUT")"
{
  echo "# Deployment proof — https://$DOMAIN"
  echo
  echo "- Checked: $(date -u +%Y-%m-%dT%H:%M:%SZ) from $(hostname) (external network)"
  echo "- Deployed commit: $(git rev-parse --short HEAD)"
  echo
  echo '```text'
  echo "\$ curl -sI http://$DOMAIN/?check=redirect"
  curl -sS -o /dev/null -w "HTTP %{http_code}  Location: %{redirect_url}\n" "http://$DOMAIN/?check=redirect"
  echo "\$ curl https://$DOMAIN/health"
  curl -fsS "https://$DOMAIN/health"; echo
  echo "\$ curl https://$DOMAIN/api/v1/health"
  curl -fsS "https://$DOMAIN/api/v1/health"; echo
  echo "\$ curl https://$DOMAIN/api/v1/tasks   # no cookie -> must be 401"
  curl -sS -o /dev/null -w "HTTP %{http_code}\n" "https://$DOMAIN/api/v1/tasks"
  echo "\$ curl -X POST https://$DOMAIN/api/v1/auth/login -H 'Origin: https://evil.example'   # must be 403"
  curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST -H 'Origin: https://evil.example' \
    -H 'Content-Type: application/json' -d '{"password":"x"}' "https://$DOMAIN/api/v1/auth/login"
  echo "\$ openssl s_client ... | openssl x509 -noout -issuer -subject -dates -ext subjectAltName"
  echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" -verify_return_error 2>/dev/null \
    | openssl x509 -noout -issuer -subject -dates -ext subjectAltName
  echo '```'
} | tee "$OUT"
echo "Saved $OUT"
