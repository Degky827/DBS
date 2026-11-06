#!/usr/bin/env bash
# Verifies a running deployment: container health, migration history, public
# endpoints, Redis connectivity reported by each service, and ledger integrity.
# Read-only. Exits non-zero on the first failed category.
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$APP_DIR"

DOMAIN="${DOMAIN:-}"
if [ -z "$DOMAIN" ]; then
    origin="$(grep '^APP_ORIGIN=' .env | head -1 | cut -d= -f2-)"
    DOMAIN="${origin#https://}"
fi
[ -n "$DOMAIN" ] || { echo "DOMAIN is not set and APP_ORIGIN is missing from .env." >&2; exit 1; }

HTTPS_PORT="${HTTPS_PORT:-443}"
HTTP_PORT="${HTTP_PORT:-80}"

# Opt-in escape hatch for a local self-signed certificate. Never set this for a
# Let's Encrypt deployment: the point of the check is that the chain validates.
CURL_OPTS=()
if [ "${CURL_INSECURE:-0}" = "1" ]; then
    CURL_OPTS+=(-k)
fi

PGUSER="$(grep '^POSTGRES_USER=' .env | head -1 | cut -d= -f2-)"
PGUSER="${PGUSER:-meridian}"

failures=0
pass() { printf '  OK   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; failures=$((failures + 1)); }

echo "== Containers"
docker compose -f docker-compose.yml ps

echo "== Migration history"
check_migrations() {
    local service="$1" db="$2" expected applied failed
    expected="$(find "backend/$service/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
    applied="$(docker compose exec -T postgres psql -U "$PGUSER" -d "$db" -tAc \
        "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL" | tr -d '[:space:]')"
    failed="$(docker compose exec -T postgres psql -U "$PGUSER" -d "$db" -tAc \
        "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL" | tr -d '[:space:]')"
    if [ "$failed" = "0" ] && [ "$applied" = "$expected" ]; then
        pass "$db: $applied/$expected migrations, 0 failed"
    else
        fail "$db: $applied/$expected migrations, $failed failed"
    fi
}
check_migrations auth-service auth_db
check_migrations user-service user_db
check_migrations kyc-service kyc_db
check_migrations notification-service notification_db

echo "== Public HTTPS endpoints"
check_http() {
    local path="$1" code
    code="$(curl "${CURL_OPTS[@]}" -sS -o /dev/null -w '%{http_code}' --max-time 10 \
        --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "https://$DOMAIN:$HTTPS_PORT$path" || true)"
    if [ "$code" = "200" ]; then pass "$path ($code)"; else fail "$path ($code)"; fi
}
check_http /healthz
check_http /api/auth/health
check_http /api/user/health
check_http /api/kyc/health
check_http /api/notifications/health

echo "== Redis reported connected"
check_redis() {
    local path="$1" body
    body="$(curl "${CURL_OPTS[@]}" -fsS --max-time 10 --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "https://$DOMAIN:$HTTPS_PORT$path" || true)"
    if printf '%s' "$body" | grep -q '"connected":true'; then
        pass "$path"
    else
        fail "$path (redis not connected)"
    fi
}
check_redis /api/auth/ready
check_redis /api/user/ready
check_redis /api/kyc/ready
check_redis /api/notifications/ready

echo "== HTTP to HTTPS redirect"
code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "$DOMAIN:$HTTP_PORT:127.0.0.1" "http://$DOMAIN:$HTTP_PORT/" || true)"
[ "$code" = "301" ] && pass "HTTP 301 to HTTPS" || fail "HTTP redirect returned $code"

echo "== Ledger integrity"
if docker compose exec -T user-service node prisma/verifyLedger.js; then
    pass "ledger verification"
else
    fail "ledger verification"
fi

echo
if [ "$failures" -eq 0 ]; then
    echo "All checks passed."
else
    echo "$failures check(s) failed."
    exit 1
fi
