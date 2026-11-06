#!/usr/bin/env bash
# End-to-end verification of a deployed Render instance.
#
# Covers the checks that can be proven through the public gateway: process
# health, database readiness, demo login, refresh-cookie flags, JWT-protected
# routes, authorization boundaries, CSRF origin enforcement, SPA routing and
# response hygiene. It never prints tokens, cookies or account data.
#
# Usage:
#   BASE_URL=https://dbs-demo.onrender.com \
#   DEMO_SEED_PASSWORD='...' \
#   ./deploy/render/scripts/deployment-verification.sh
#
# Optional:
#   DEMO_EMAIL      demo account email (default demo@meridianbank.test)
#   APP_ORIGIN      trusted origin to send (default BASE_URL)
#   EXPECTED_COOKIE refresh cookie name (default meridian_refresh)
set -euo pipefail

BASE_URL="${BASE_URL:-${1:-}}"
DEMO_EMAIL="${DEMO_EMAIL:-demo@meridianbank.test}"
DEMO_PASSWORD="${DEMO_PASSWORD:-${DEMO_SEED_PASSWORD:-}}"
EXPECTED_COOKIE="${EXPECTED_COOKIE:-meridian_refresh}"

if [ -z "$BASE_URL" ]; then
  echo "Usage: BASE_URL=https://your-service.onrender.com DEMO_SEED_PASSWORD='...' $0" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"
ORIGIN="${APP_ORIGIN:-$BASE_URL}"

# The login body is built by Node so passwords with quotes stay valid JSON.
export DEMO_EMAIL DEMO_PASSWORD

if [ -z "$DEMO_PASSWORD" ]; then
  echo "DEMO_SEED_PASSWORD (or DEMO_PASSWORD) must be set to verify login." >&2
  exit 2
fi

failures=0
pass() { printf '  OK   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; failures=$((failures + 1)); }

WORK_DIR="$(mktemp -d)"
chmod 700 "$WORK_DIR"
trap 'rm -rf "$WORK_DIR"' EXIT
BODY="$WORK_DIR/body.json"
HEADERS="$WORK_DIR/headers.txt"

request() {
  local url="$1"
  shift
  curl --silent --show-error --max-time 90 \
    --output "$BODY" --dump-header "$HEADERS" --write-out '%{http_code}' \
    "$@" "$url" || printf '000'
}

status_is() {
  local expected="$1" actual="$2" label="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$label -> $actual"
  else
    fail "$label -> $actual (expected $expected)"
  fi
}

json_message() {
  # Message only: the payload may legitimately contain an access token.
  node -e '
    try {
      const body = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      process.stdout.write(String(body.message || "").slice(0, 160));
    } catch {}
  ' "$BODY" 2>/dev/null || true
}

assert_no_secrets() {
  local label="$1"
  if grep -Eqi 'xkeysib-|postgres(ql)?://|redis(s)?://|JWT_SECRET|INTERNAL_SERVICE_KEY|STORAGE_ENCRYPTION_KEY|MFA_ENCRYPTION_KEY' "$BODY"; then
    fail "$label response contains a secret or connection string"
  else
    pass "$label response does not leak secrets"
  fi
}

echo "== Readiness ($BASE_URL)"
code=""
for attempt in 1 2 3 4 5; do
  code="$(request "$BASE_URL/healthz")"
  [ "$code" = "200" ] && break
  echo "  waiting for the free instance to wake (attempt $attempt/5, HTTP $code)"
  sleep 15
done
status_is 200 "$code" "/healthz"
if [ "$code" = "200" ] && grep -q '"status":"ok"' "$BODY"; then
  pass "aggregated health reports ok"
else
  fail "aggregated health is not ok"
fi

echo "== Service health"
status_is 200 "$(request "$BASE_URL/api/auth/health")" "/api/auth/health"
status_is 200 "$(request "$BASE_URL/api/user/health")" "/api/user/health"
status_is 200 "$(request "$BASE_URL/api/kyc/health")" "/api/kyc/health"
status_is 200 "$(request "$BASE_URL/api/notifications/health")" "/api/notifications/health"

echo "== Database readiness"
status_is 200 "$(request "$BASE_URL/api/auth/ready")" "/api/auth/ready (SELECT 1)"

echo "== Authentication"
node -e '
  process.stdout.write(JSON.stringify({
    email: process.env.DEMO_EMAIL,
    password: process.env.DEMO_PASSWORD,
  }));
' > "$WORK_DIR/login.json"
chmod 600 "$WORK_DIR/login.json"

code="$(request "$BASE_URL/api/auth/auth/login" \
  --header "Origin: $ORIGIN" \
  --header "Content-Type: application/json" \
  --data-binary "@$WORK_DIR/login.json")"
status_is 200 "$code" "demo login"
if [ "$code" = "200" ]; then
  pass "login response: $(json_message)"
  assert_no_secrets "login"
fi

ACCESS_TOKEN=""
if node -e '
  const fs = require("fs");
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const token = body && body.data && body.data.accessToken;
  if (typeof token !== "string" || token.length < 20) process.exit(1);
  fs.writeFileSync(process.argv[2], token, { mode: 0o600 });
' "$BODY" "$WORK_DIR/token" 2>/dev/null; then
  ACCESS_TOKEN="$(cat "$WORK_DIR/token")"
  pass "access token issued (${#ACCESS_TOKEN} chars, value not printed)"
else
  fail "login did not return an access token (is the demo seed applied?)"
fi

if [ -n "$ACCESS_TOKEN" ]; then
  printf 'header = "Authorization: Bearer %s"\n' "$ACCESS_TOKEN" > "$WORK_DIR/auth.curlrc"
  chmod 600 "$WORK_DIR/auth.curlrc"
  AUTH_ARGS=(--config "$WORK_DIR/auth.curlrc")
else
  AUTH_ARGS=()
fi

echo "== Session cookie"
cookie_line="$(grep -i '^set-cookie:' "$HEADERS" | head -n 1 || true)"
if [ -z "$cookie_line" ]; then
  fail "login did not set a refresh cookie"
else
  case "$cookie_line" in
    *"$EXPECTED_COOKIE="*) pass "$EXPECTED_COOKIE cookie issued" ;;
    *) fail "refresh cookie name is not $EXPECTED_COOKIE" ;;
  esac
  case "$cookie_line" in
    *Path=/api/auth*) pass "cookie scoped to Path=/api/auth" ;;
    *) fail "cookie is not scoped to /api/auth (the gateway rewrite may be wrong)" ;;
  esac
  grep -qi 'HttpOnly' <<<"$cookie_line" && pass "cookie is HttpOnly" || fail "cookie is not HttpOnly"
  grep -qi 'Secure' <<<"$cookie_line" && pass "cookie is Secure" || fail "cookie is not Secure"
  grep -qi 'SameSite' <<<"$cookie_line" && pass "cookie declares SameSite" || fail "cookie has no SameSite"
fi

echo "== Authorization"
if [ -n "$ACCESS_TOKEN" ]; then
  status_is 200 "$(request "$BASE_URL/api/auth/auth/me" "${AUTH_ARGS[@]}")" "/api/auth/auth/me with JWT"
  status_is 200 "$(request "$BASE_URL/api/user/users/me" "${AUTH_ARGS[@]}")" "/api/user/users/me with JWT"
  assert_no_secrets "/api/user/users/me"
else
  fail "skipping authenticated checks without a token"
fi
status_is 401 "$(request "$BASE_URL/api/user/users/me")" "/api/user/users/me without JWT"
status_is 403 "$(request "$BASE_URL/api/auth/internal/tokens/introspect" -X POST)" "internal service route blocked"

echo "== CSRF origin enforcement"
code="$(request "$BASE_URL/api/auth/auth/login" \
  --header "Origin: https://attacker.example" \
  --header "Content-Type: application/json" \
  --data-binary "@$WORK_DIR/login.json")"
status_is 403 "$code" "login from untrusted origin"

echo "== SPA routing"
status_is 200 "$(request "$BASE_URL/login")" "deep link /login"
grep -q '<div id="root"' "$BODY" && pass "deep link serves the SPA shell" || fail "deep link did not serve the SPA shell"

echo "== Response hygiene"
for header in X-Content-Type-Options X-Frame-Options Content-Security-Policy Referrer-Policy; do
  if grep -qi "^$header:" <<<"$(curl --silent --show-error --head --max-time 30 "$BASE_URL/" || true)"; then
    pass "$header present"
  else
    fail "$header missing"
  fi
done

echo
if [ "$failures" -eq 0 ]; then
  echo "Deployment verification passed."
  echo "Manual checks still required: Brevo delivery, Chapa sandbox callback, Didit sandbox flow."
else
  echo "$failures check(s) failed."
  exit 1
fi
