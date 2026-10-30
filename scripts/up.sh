#!/usr/bin/env bash
#
# One-command full stack for Planora: builds the images, starts PostgreSQL,
# applies the migration history, brings up the remaining services and waits
# for the API to answer. Replaces the four ordered `docker compose` calls
# the Quickstart used to spell out, so a fresh clone needs exactly one
# command.
#
# Targets stock macOS bash (3.2) as well as Linux bash: no bash-4-only
# syntax, no GNU-only tool or flag. Works from any invocation directory.
#
# Usage (from anywhere in the repository, or by absolute path):
#   scripts/up.sh                       # start, generating an env file if needed
#   scripts/up.sh --down                # stop, keeping the data volumes
#
# Configuration lives in the env file named by PLANORA_ENV_FILE (default
# .tmp/planora.env, git-ignored). When that file does not exist it is
# generated from deploy/.env.example with random local secrets and
# LLM_API_KEY=placeholder, which runs everything except the AI features;
# the generated site password is printed once at the end. An existing file
# is never modified, so a filled-in LLM_API_KEY survives a restart.

set -euo pipefail

# --- Locate the repository root, independent of the caller's cwd -----------
#
# Portably follows a symlinked $0 one hop at a time with plain `readlink`
# (no non-standard flag), matching scripts/run-local.sh.
_resolve_repo_root() {
    src="$1"
    while [ -h "$src" ]; do
        dir="$(cd -P "$(dirname "$src")" >/dev/null 2>&1 && pwd)"
        src="$(readlink "$src")"
        case "$src" in
            /*) ;;
            *) src="$dir/$src" ;;
        esac
    done
    cd -P "$(dirname "$src")/.." >/dev/null 2>&1 && pwd
}

REPO_ROOT="$(_resolve_repo_root "$0")"
cd "$REPO_ROOT"

ENV_FILE="${PLANORA_ENV_FILE:-.tmp/planora.env}"
PROJECT="${PLANORA_PROJECT:-planora-local}"
COMPOSE_FILE="deploy/compose.yml"
EXAMPLE_ENV="deploy/.env.example"

die() {
    echo "error: $*" >&2
    exit 1
}

# --- Preflight -------------------------------------------------------------

command -v docker >/dev/null 2>&1 || die "docker is not installed; see README Quickstart"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required (Compose 2.24 or later)"
command -v openssl >/dev/null 2>&1 || die "openssl is required to generate local secrets"

compose() {
    docker compose --env-file "$ENV_FILE" -p "$PROJECT" -f "$COMPOSE_FILE" "$@"
}

# --- Stop ------------------------------------------------------------------

if [ "${1:-}" = "--down" ]; then
    [ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE; nothing to stop"
    echo "==> Stopping $PROJECT (data volumes are kept)"
    compose down
    exit 0
fi

[ "$#" -eq 0 ] || die "unknown argument: $1 (usage: scripts/up.sh [--down])"

# --- Generate an env file on first run -------------------------------------
#
# Secrets are hex so they never need URL-encoding inside DATABASE_URL, and
# comfortably exceed the API's minimum lengths (APP_PASSWORD 12,
# SESSION_SECRET 32). The API refuses to start if either is too short.

GENERATED_PASSWORD=""

if [ ! -f "$ENV_FILE" ]; then
    [ -f "$EXAMPLE_ENV" ] || die "missing $EXAMPLE_ENV"

    echo "==> No $ENV_FILE yet; generating one with random local secrets"
    mkdir -p "$(dirname "$ENV_FILE")"

    pg_password="$(openssl rand -hex 16)"
    app_password="$(openssl rand -hex 12)"
    session_secret="$(openssl rand -hex 32)"
    pg_user="planora"
    pg_db="planora"

    # Fill only the empty values the example leaves for the operator; every
    # other line (ports, subnets, timezone) is copied through untouched.
    awk -v pg_password="$pg_password" \
        -v app_password="$app_password" \
        -v session_secret="$session_secret" \
        -v pg_user="$pg_user" \
        -v pg_db="$pg_db" '
        /^POSTGRES_PASSWORD=$/ { print "POSTGRES_PASSWORD=" pg_password; next }
        /^APP_PASSWORD=$/      { print "APP_PASSWORD=" app_password; next }
        /^SESSION_SECRET=$/    { print "SESSION_SECRET=" session_secret; next }
        /^LLM_API_KEY=$/       { print "LLM_API_KEY=placeholder"; next }
        /^DATABASE_URL=$/ {
            print "DATABASE_URL=postgresql+psycopg://" pg_user ":" pg_password "@db:5432/" pg_db
            next
        }
        { print }
    ' "$EXAMPLE_ENV" > "$ENV_FILE"

    chmod 600 "$ENV_FILE"
    GENERATED_PASSWORD="$app_password"
fi

# A stale or hand-edited file still has to satisfy the schema before we
# spend minutes building images: `config` fails naming the missing value.
compose config --quiet || die "$ENV_FILE is incomplete; see README Configuration"

# --- Start -----------------------------------------------------------------

echo "==> Building images"
compose build

echo "==> Starting PostgreSQL"
compose up -d --wait db

echo "==> Applying migrations"
compose run --rm --no-deps api alembic upgrade head

echo "==> Starting the remaining services"
compose up -d --wait

APP_ORIGIN="$(compose config --format json \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["api"]["environment"]["APP_ORIGIN"])' \
    2>/dev/null || echo "http://127.0.0.1:18080")"

echo "==> Waiting for the API"
curl --fail --silent --show-error --retry 30 --retry-all-errors --retry-delay 1 \
    "$APP_ORIGIN/api/v1/health" >/dev/null
echo "    ok"

echo
echo "Planora is running at $APP_ORIGIN"
if [ -n "$GENERATED_PASSWORD" ]; then
    echo "Site password (generated, stored in $ENV_FILE): $GENERATED_PASSWORD"
    echo "AI features are off until LLM_API_KEY is set in $ENV_FILE."
fi
echo "Stop with: scripts/up.sh --down"
