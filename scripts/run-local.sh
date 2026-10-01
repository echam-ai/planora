#!/usr/bin/env bash
#
# One-command local run for Planora (issue #93): starts the API (uvicorn),
# the web dev server in HTTP mode (vite dev), and the hourly archive job's
# scheduler loop (planora_api.jobs.scheduler) as three supervised
# processes. Docker is never required.
#
# Targets stock macOS bash (3.2) as well as Linux bash: no bash-4-only
# syntax, no GNU-only tool or flag. Works from any invocation directory.
#
# Usage (from anywhere in the repository, or by absolute path):
#   scripts/run-local.sh
#   scripts/run-local.sh --setup-account  # explicitly create/reset account
#
# Configuration lives entirely in apps/api/.env (copy from
# apps/api/.env.example — see README.md, "Run locally on macOS"). This
# script derives VITE_API_MODE and PLANORA_API_PROXY_TARGET itself, so
# they can never drift from the API this script actually started; it
# never reads apps/web/.env for those two values.
#
# Stop with Ctrl-C (SIGINT) or SIGTERM. All three processes are stopped
# within 10 seconds; if one exits unexpectedly, the other two are stopped
# too and the launcher exits non-zero, naming the one that stopped.

set -euo pipefail
set -m # Job control: each backgrounded service becomes its own process
       # group leader, so one signal to "-$pid" reaches it and any child
       # it spawns (e.g. vite's own subprocess) with no separate
       # session-leader tool.

# --- Locate the repository root, independent of the caller's cwd -----------
#
# Portably follows a symlinked $0 one hop at a time with plain `readlink`
# (no non-standard flag), the same idiom long used by macOS-targeting
# shell tooling.
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
    dir="$(cd -P "$(dirname "$src")" >/dev/null 2>&1 && pwd)"
    (cd "$dir/.." && pwd)
}

REPO_ROOT="$(_resolve_repo_root "$0")"
API_DIR="$REPO_ROOT/apps/api"
WEB_DIR="$REPO_ROOT/apps/web"
ENV_FILE="$API_DIR/.env"

API_HOST="127.0.0.1"
API_PORT="8000"

log() { printf 'planora: %s\n' "$*"; }
err() { printf 'planora: %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

SETUP_ACCOUNT=0
case "$#:${1:-}" in
    0:) ;;
    1:--setup-account) SETUP_ACCOUNT=1 ;;
    *) die "Usage: scripts/run-local.sh [--setup-account]" ;;
esac

# Reads one KEY=value line from the env file, ignoring comment and blank
# lines, and never `source`s the file — a value containing a shell
# metacharacter can never be executed. Prints the last matching value, or
# an empty string when the key is absent.
env_get() {
    key="$1"
    file="$2"
    line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
    printf '%s' "${line#*=}"
}

is_alive() {
    [ -n "$1" ] && kill -0 "$1" 2>/dev/null
}

is_blank() {
    case "$1" in
        *[![:space:]]*) return 1 ;;
        *) return 0 ;;
    esac
}

# --- Configuration checks: fail before any process starts ------------------

if [ ! -f "$ENV_FILE" ]; then
    die "apps/api/.env not found. Copy apps/api/.env.example to apps/api/.env and fill in LLM_API_KEY, then re-run this script."
fi

SESSION_SECRET_VALUE="$(env_get SESSION_SECRET "$ENV_FILE")"

LLM_API_KEY_VALUE="$(env_get LLM_API_KEY "$ENV_FILE")"
if is_blank "$LLM_API_KEY_VALUE"; then
    die "LLM_API_KEY is blank in apps/api/.env. A placeholder value is fine locally (AI features will report unavailable), but it must be non-blank."
fi

APP_ORIGIN_VALUE="$(env_get APP_ORIGIN "$ENV_FILE")"
if is_blank "$APP_ORIGIN_VALUE"; then
    APP_ORIGIN_VALUE="http://localhost:5173"
fi
WEB_HOST=""
WEB_PORT=""
case "$APP_ORIGIN_VALUE" in
    http://localhost:*)
        WEB_HOST="localhost"
        WEB_PORT="${APP_ORIGIN_VALUE#http://localhost:}"
        ;;
    http://127.0.0.1:*)
        WEB_HOST="127.0.0.1"
        WEB_PORT="${APP_ORIGIN_VALUE#http://127.0.0.1:}"
        ;;
esac
case "$WEB_PORT" in
    '' | *[!0-9]* | 0*) WEB_HOST="" ;;
esac
if [ -n "$WEB_HOST" ] && { [ "${#WEB_PORT}" -gt 5 ] || [ "$WEB_PORT" -gt 65535 ]; }; then
    WEB_HOST=""
fi
if [ -z "$WEB_HOST" ]; then
    die "APP_ORIGIN in apps/api/.env must be exactly http://localhost:<port> or http://127.0.0.1:<port>, with a port from 1 to 65535."
fi

# --- Install dependencies and apply migrations, still before any service --

log "Configuration OK. Installing dependencies and applying migrations..."

if ! (cd "$API_DIR" && uv sync --locked); then
    die "uv sync --locked failed in apps/api."
fi

# Probe every loopback address the services will use before starting any of
# them. A response from an existing API is not evidence that ours started.
# SO_REUSEADDR permits immediate restart after shutdown, without sharing an
# active listener. Keep the probes open together to detect conflicting ports.
if [ "$SETUP_ACCOUNT" -eq 0 ]; then
    if ! (cd "$API_DIR" && uv run python -c '
import socket
import sys

probes = []
for service, host, port in (("API", sys.argv[1], sys.argv[2]),
                          ("web", sys.argv[3], sys.argv[4])):
    try:
        addresses = socket.getaddrinfo(host, int(port), type=socket.SOCK_STREAM)
        for family, kind, protocol, _, address in addresses:
            probe = socket.socket(family, kind, protocol)
            probes.append(probe)
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(address)
    except OSError:
        print(f"planora: {service} port {port} is unavailable. Stop the existing local launcher with Ctrl-C, or inspect the listener before retrying.", file=sys.stderr)
        sys.exit(1)
' "$API_HOST" "$API_PORT" "$WEB_HOST" "$WEB_PORT"); then
        die "Required local ports are unavailable; no services were started."
    fi
fi

# Generate once, keep it only in this invocation's environment, and share
# identical values with migrations, administration and every service. Export
# explicit file values too, so inherited shell settings cannot override them.
if is_blank "$SESSION_SECRET_VALUE"; then
    if ! SESSION_SECRET_VALUE="$(cd "$API_DIR" && uv run python -c 'import secrets; print(secrets.token_hex(32))')"; then
        die "Could not generate a local SESSION_SECRET."
    fi
fi
export SESSION_SECRET="$SESSION_SECRET_VALUE"
export APP_ORIGIN="$APP_ORIGIN_VALUE"
export LLM_API_KEY="$LLM_API_KEY_VALUE"

if [ "$SETUP_ACCOUNT" -eq 0 ] && ! (cd "$WEB_DIR" && bun install --frozen-lockfile); then
    die "bun install --frozen-lockfile failed in apps/web."
fi

if ! (cd "$API_DIR" && uv run alembic upgrade head); then
    die "alembic upgrade head failed in apps/api."
fi

if [ "$SETUP_ACCOUNT" -eq 1 ]; then
    log "Creating or resetting the local account through the interactive prompts..."
    cd "$API_DIR"
    exec uv run python -m planora_api.admin.reset_password
fi

# --- Start the three supervised services ------------------------------------

API_PID=""
WEB_PID=""
SCHEDULER_PID=""
FAILURE_SERVICE=""
STOP_REQUESTED=0

log "Starting the API, the web dev server and the archive scheduler..."

(
    cd "$API_DIR"
    exec uv run uvicorn planora_api.main:create_app --factory \
        --host "$API_HOST" --port "$API_PORT" --workers 1
) &
API_PID=$!

(
    cd "$WEB_DIR"
    export VITE_API_MODE=http
    export PLANORA_API_PROXY_TARGET="http://${API_HOST}:${API_PORT}"
    exec bun run dev -- --host "$WEB_HOST" --port "$WEB_PORT" --strictPort
) &
WEB_PID=$!

(
    cd "$API_DIR"
    exec uv run python -m planora_api.jobs.scheduler
) &
SCHEDULER_PID=$!

# --- Signal handling and shutdown -------------------------------------------

# True while any process is still in the group led by "$1" (the group's ID
# is the leader's PID, and stays reserved while any member lives). Uses the
# `kill -0 -- -PGID` idiom, which works on stock macOS and Linux.
group_alive() {
    [ -n "$1" ] && kill -0 -- "-$1" 2>/dev/null
}

# Signals the whole group, even when its recorded leader is already dead:
# the leader's children (uvicorn under `uv run`, vite under `bun run dev`)
# outlive a SIGKILLed leader and would otherwise keep their port. An empty
# group is a no-op, and the builtin's error text is discarded.
stop_process_group() {
    pid="$1"
    signal="$2"
    if group_alive "$pid"; then
        kill "-${signal}" -- "-${pid}" 2>/dev/null || true
    fi
}

shutdown_all() {
    exit_code="$1"
    trap '' INT TERM

    stop_process_group "$API_PID" TERM
    stop_process_group "$WEB_PID" TERM
    stop_process_group "$SCHEDULER_PID" TERM

    waited=0
    while [ "$waited" -lt 10 ]; do
        if ! group_alive "$API_PID" && ! group_alive "$WEB_PID" && ! group_alive "$SCHEDULER_PID"; then
            break
        fi
        sleep 1
        waited=$((waited + 1))
    done

    stop_process_group "$API_PID" KILL
    stop_process_group "$WEB_PID" KILL
    stop_process_group "$SCHEDULER_PID" KILL

    wait "$API_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
    wait "$SCHEDULER_PID" 2>/dev/null || true

    if [ -n "$FAILURE_SERVICE" ]; then
        err "${FAILURE_SERVICE} stopped; the other services have been stopped too."
    else
        log "Stopped."
    fi
    exit "$exit_code"
}

on_signal() {
    STOP_REQUESTED=1
}

trap on_signal INT TERM

# --- Wait for readiness, then supervise until stopped -----------------------

wait_for_health() {
    waited=0
    waiting_service="the API"
    while [ "$waited" -lt 60 ]; do
        if [ "$STOP_REQUESTED" -eq 1 ]; then
            shutdown_all 0
        fi
        if ! is_alive "$API_PID"; then
            FAILURE_SERVICE="the API"
            return 1
        fi
        if ! is_alive "$WEB_PID"; then
            FAILURE_SERVICE="the web dev server"
            return 1
        fi
        if ! is_alive "$SCHEDULER_PID"; then
            FAILURE_SERVICE="the archive scheduler"
            return 1
        fi
        waiting_service="the API"
        if curl -fsS --connect-timeout 1 --max-time 2 -o /dev/null "http://${API_HOST}:${API_PORT}/api/v1/health" 2>/dev/null; then
            waiting_service="the web dev server"
            if curl -fsS --connect-timeout 1 --max-time 2 -o /dev/null "${APP_ORIGIN_VALUE}/" 2>/dev/null \
                && curl -fsS --connect-timeout 1 --max-time 2 -o /dev/null "${APP_ORIGIN_VALUE}/api/v1/health" 2>/dev/null; then
                if is_alive "$API_PID" && is_alive "$WEB_PID" && is_alive "$SCHEDULER_PID"; then
                    return 0
                fi
            fi
        fi
        sleep 1
        waited=$((waited + 1))
    done
    FAILURE_SERVICE="${waiting_service} (readiness checks timed out)"
    return 1
}

if ! wait_for_health; then
    shutdown_all 1
fi

log "Ready. Open ${APP_ORIGIN_VALUE} in your browser."
log "First time only: scripts/run-local.sh --setup-account"
log "Press Ctrl-C to stop."

while true; do
    if [ "$STOP_REQUESTED" -eq 1 ]; then
        shutdown_all 0
    fi
    if ! is_alive "$API_PID"; then
        FAILURE_SERVICE="the API"
        shutdown_all 1
    fi
    if ! is_alive "$WEB_PID"; then
        FAILURE_SERVICE="the web dev server"
        shutdown_all 1
    fi
    if ! is_alive "$SCHEDULER_PID"; then
        FAILURE_SERVICE="the archive scheduler"
        shutdown_all 1
    fi
    sleep 1
done
