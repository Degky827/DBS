#!/usr/bin/env bash
# Pre-flight checks for a Render/Neon deployment.
#
# Validates the environment matrix, checks that every PostgreSQL URL answers,
# and (unless --check-only) applies each service's Prisma migrations with
# `migrate deploy`. Never resets or seeds a database.
#
# Usage:
#   ./deploy/render/scripts/pre-deploy.sh --env-file .env.render
#   ./deploy/render/scripts/pre-deploy.sh --env-file .env.render --check-only
#
# The env file is parsed, not sourced, so values containing ? or & are safe.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
ENV_FILE=""
CHECK_ONLY=0

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --check-only) CHECK_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

failures=0
pass() { printf '  OK   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; failures=$((failures + 1)); }
warn() { printf '  WARN %s\n' "$1"; }

load_env_file() {
  local file="$1" line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
    esac
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      ''|*[!A-Za-z0-9_]*) continue ;;
    esac
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    export "$key=$value"
  done < "$file"
}

redact() {
  printf '%s' "$1" | sed -E 's#(://[^:/]+:)[^@]+@#\1***@#'
}

if [ -n "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || { echo "Env file not found: $ENV_FILE" >&2; exit 1; }
  load_env_file "$ENV_FILE"
  echo "Loaded environment from $ENV_FILE"
fi

echo "== Required secrets"
require_value() {
  local name="$1" min="${2:-1}" value
  value="$(printenv "$name" || true)"
  if [ -n "$value" ] && [ "${#value}" -ge "$min" ]; then
    pass "$name is set (${#value} chars)"
  else
    fail "$name must be set with at least $min characters"
  fi
}
require_value JWT_SECRET 32
require_value INTERNAL_SERVICE_KEY 32
require_value STORAGE_ENCRYPTION_KEY 64
require_value MFA_ENCRYPTION_KEY 64
require_value EMAIL_FROM_EMAIL 3

brevo_key="${BREVO_API_KEY:-}"
sendgrid_key="${SENDGRID_API_KEY:-}"
if [ -z "$brevo_key" ] && [ -z "$sendgrid_key" ]; then
  fail "BREVO_API_KEY or SENDGRID_API_KEY must be set (HTTPS email; Render blocks SMTP)"
fi
if [ -n "$brevo_key" ]; then
  case "$brevo_key" in
    xkeysib-*) pass "BREVO_API_KEY is a Brevo REST key" ;;
    *) fail "BREVO_API_KEY must be an xkeysib- REST key (Render blocks outbound SMTP)" ;;
  esac
fi
if [ -n "$sendgrid_key" ]; then
  case "$sendgrid_key" in
    SG.*) pass "SENDGRID_API_KEY is a SendGrid API key" ;;
    *) fail "SENDGRID_API_KEY must start with SG." ;;
  esac
fi
case "${EMAIL_TRANSPORT:-}" in
  '')
    if [ -n "$sendgrid_key" ]; then
      pass "EMAIL_TRANSPORT unset; auto-detect selects SendGrid"
    else
      pass "EMAIL_TRANSPORT unset; auto-detect selects Brevo API"
    fi
    ;;
  api)
    case "$brevo_key" in
      xkeysib-*) pass "EMAIL_TRANSPORT=api matches the Brevo REST key" ;;
      *) fail "EMAIL_TRANSPORT=api requires a Brevo REST key (xkeysib-)" ;;
    esac
    ;;
  sendgrid)
    if [ -n "$sendgrid_key" ]; then
      pass "EMAIL_TRANSPORT=sendgrid matches SENDGRID_API_KEY"
    else
      fail "EMAIL_TRANSPORT=sendgrid requires SENDGRID_API_KEY"
    fi
    ;;
  *) fail "EMAIL_TRANSPORT must be api, sendgrid, or unset (smtp is blocked on Render)" ;;
esac

if printf '%s' "${STORAGE_ENCRYPTION_KEY:-}" | grep -Eq '^[a-fA-F0-9]{64}$'; then
  pass "STORAGE_ENCRYPTION_KEY is 64 hex characters"
else
  fail "STORAGE_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)"
fi
if printf '%s' "${MFA_ENCRYPTION_KEY:-}" | grep -Eq '^[a-fA-F0-9]{64}$'; then
  pass "MFA_ENCRYPTION_KEY is 64 hex characters"
else
  fail "MFA_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)"
fi

if [ "${DEMO_SEED_ENABLED:-false}" = "true" ]; then
  require_value DEMO_SEED_PASSWORD 12
fi

echo "== PostgreSQL URLs"
for variable in AUTH_DATABASE_URL USER_DATABASE_URL KYC_DATABASE_URL NOTIFICATION_DATABASE_URL; do
  value="$(printenv "$variable" || true)"
  if [ -z "$value" ]; then
    fail "$variable is not set"
    continue
  fi
  pass "$variable -> $(redact "$value")"
  case "$value" in
    *sslmode=require*) ;;
    *) warn "$variable has no sslmode=require (Neon requires TLS)" ;;
  esac
done

if [ "$failures" -eq 0 ]; then
  echo "== Database connectivity"
  if command -v docker >/dev/null 2>&1; then
    for variable in AUTH_DATABASE_URL USER_DATABASE_URL KYC_DATABASE_URL NOTIFICATION_DATABASE_URL; do
      value="$(printenv "$variable" || true)"
      [ -n "$value" ] || continue
      if docker run --rm postgres:16-alpine psql "$value" -tAc 'SELECT 1' >/dev/null 2>&1; then
        pass "$variable answers SELECT 1"
      else
        fail "$variable did not answer (check the host, password, database and sslmode)"
      fi
    done
  else
    warn "docker not found; skipping connectivity check"
  fi
fi

if [ "$CHECK_ONLY" -eq 0 ] && [ "$failures" -eq 0 ]; then
  echo "== Migrations (non-destructive: prisma migrate deploy)"
  for service in auth-service user-service kyc-service notification-service; do
    case "$service" in
      auth-service) url="$AUTH_DATABASE_URL" ;;
      user-service) url="$USER_DATABASE_URL" ;;
      kyc-service) url="$KYC_DATABASE_URL" ;;
      notification-service) url="$NOTIFICATION_DATABASE_URL" ;;
    esac
    directory="$ROOT_DIR/backend/$service"
    if [ ! -d "$directory/node_modules" ]; then
      echo "  Installing $service dependencies (npm ci)"
      ( cd "$directory" && npm ci --no-audit --no-fund >/dev/null )
    fi
    if ( cd "$directory" && DATABASE_URL="$url" npx prisma migrate deploy ); then
      pass "$service migrations"
    else
      fail "$service migrations"
    fi
  done
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "Pre-deploy checks passed."
else
  echo "$failures check(s) failed."
  exit 1
fi
