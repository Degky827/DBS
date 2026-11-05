#!/usr/bin/env bash
# Read-only health check for a deployed Render service.
#
# Usage:
#   BASE_URL=https://dbs-demo.onrender.com ./deploy/render/scripts/health-check.sh
#   ./deploy/render/scripts/health-check.sh https://dbs-demo.onrender.com
#
# Retries the first request because Render free instances spin down after 15
# minutes of inactivity and need time to wake.
set -euo pipefail

BASE_URL="${BASE_URL:-${1:-}}"
if [ -z "$BASE_URL" ]; then
  echo "Usage: BASE_URL=https://your-service.onrender.com $0" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"

failures=0
pass() { printf '  OK   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; failures=$((failures + 1)); }

request() {
  local url="$1" output="$2"
  curl --silent --show-error --location --max-time 90 \
    --output "$output" --write-out '%{http_code}' "$url" || printf '000'
}

echo "== Gateway ($BASE_URL)"
body="$(mktemp)"
trap 'rm -f "$body"' EXIT

code=""
for attempt in 1 2 3 4 5; do
  code="$(request "$BASE_URL/healthz" "$body")"
  [ "$code" = "200" ] && break
  echo "  waiting for the free instance to wake (attempt $attempt/5, HTTP $code)"
  sleep 15
done

if [ "$code" = "200" ]; then
  pass "/healthz -> 200"
  if grep -q '"status":"ok"' "$body"; then
    pass "all four services report healthy"
  else
    fail "readiness payload is not ok: $(head -c 300 "$body")"
  fi
else
  fail "/healthz -> HTTP $code"
fi

echo "== Service endpoints"
for path in /api/auth/health /api/user/health /api/kyc/health /api/notifications/health; do
  code="$(request "$BASE_URL$path" "$body")"
  [ "$code" = "200" ] && pass "$path -> 200" || fail "$path -> HTTP $code"
done

echo "== SPA"
code="$(request "$BASE_URL/" "$body")"
if [ "$code" = "200" ] && grep -q '<div id="root"' "$body"; then
  pass "SPA index served"
else
  fail "SPA index (HTTP $code)"
fi

echo "== Security headers"
headers="$(curl --silent --show-error --head --max-time 30 "$BASE_URL/" || true)"
for header in X-Content-Type-Options X-Frame-Options Content-Security-Policy; do
  if printf '%s' "$headers" | grep -qi "^$header:"; then
    pass "$header present"
  else
    fail "$header missing"
  fi
done

echo
if [ "$failures" -eq 0 ]; then
  echo "Health checks passed."
else
  echo "$failures check(s) failed."
  exit 1
fi
